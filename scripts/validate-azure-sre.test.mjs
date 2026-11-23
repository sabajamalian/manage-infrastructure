import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { parseProfile, parseYaml, validateProfile, validateWorkflow,
  listAllTools, validateInventory } from './validate-azure-sre.mjs';

const profile = parseProfile(await readFile(new URL('../.github/agents/azure-sre.agent.md', import.meta.url), 'utf8'));
const workflow = parseYaml(await readFile(new URL('../.github/workflows/copilot-setup-steps.yml', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = manifest.devDependencies['@azure/mcp'];

test('rejects wildcard, YOLO and unreviewed mutation access at each exposure layer', () => {
  for (const tool of ['*', 'sreagent_threads_investigate_yolo', 'sreagent_workflows_apply']) {
    const changed = structuredClone(profile);
    changed['mcp-servers']['azure-sre-mcp'].tools.push(tool);
    assert.throws(() => validateProfile(changed, version), /least-privilege/);
  }
  const changed = structuredClone(profile);
  changed.tools.push('azure-sre-mcp/*');
  assert.throws(() => validateProfile(changed, version), /allowlists differ/);
});

test('rejects namespace routing and dangerous confirmation bypass', () => {
  for (const flag of ['--namespace', '--dangerously-disable-elicitation']) {
    const changed = structuredClone(profile);
    changed['mcp-servers']['azure-sre-mcp'].args.push(flag);
    assert.throws(() => validateProfile(changed, version), /individual tools/);
  }
});

test('rejects credential changes, duplicate keys and unsupported frontmatter', () => {
  const changed = structuredClone(profile);
  changed['mcp-servers']['azure-sre-mcp'].env.AZURE_CLIENT_SECRET = 'not-a-real-secret';
  assert.throws(() => validateProfile(changed, version));
  assert.throws(() => parseProfile('---\nname: a\nname: b\n---\nprompt'), /Map keys must be unique/);
  assert.throws(() => validateProfile({ ...profile, handoffs: [] }, version), /agent property/);
});

test('rejects untrusted workflow events and excess token permissions', () => {
  assert.throws(() => validateWorkflow({ ...workflow, on: { pull_request: null } }, version), /untrusted/);
  const changed = structuredClone(workflow);
  changed.jobs['copilot-setup-steps'].permissions.contents = 'write';
  assert.throws(() => validateWorkflow(changed, version));
});

test('rejects secret-based login and floating action tags', () => {
  const changed = structuredClone(workflow);
  const login = changed.jobs['copilot-setup-steps'].steps.find(step => step.uses?.startsWith('azure/login@'));
  login.with.creds = '${{ secrets.AZURE_CREDENTIALS }}';
  assert.throws(() => validateWorkflow(changed, version), /OIDC identity/);
  delete login.with.creds;
  login.uses = 'azure/login@v3';
  assert.throws(() => validateWorkflow(changed, version));
});

test('manual SRE access check rejects an incomplete target before invoking Azure', () => {
  const check = workflow.jobs['copilot-setup-steps'].steps.at(-1).run;
  for (const [resourceGroup, agentName] of [['group', ''], ['', 'agent']]) {
    const result = spawnSync('bash', ['-c', check], {
      env: { PATH: process.env.PATH, SRE_RESOURCE_GROUP: resourceGroup,
        SRE_AGENT_NAME: agentName, AZURE_SUBSCRIPTION_ID: 'test-subscription' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error::Provide both/);
  }
});

test('manual SRE access check remains dispatch-only and uses the pinned MCP version', () => {
  const changed = structuredClone(workflow);
  changed.jobs['copilot-setup-steps'].steps.at(-1).if = '${{ true }}';
  assert.throws(() => validateWorkflow(changed, version));
  changed.jobs['copilot-setup-steps'].steps.at(-1).if = workflow.jobs['copilot-setup-steps'].steps.at(-1).if;
  changed.jobs['copilot-setup-steps'].steps.at(-1).run = 'npx @azure/mcp@latest';
  assert.throws(() => validateWorkflow(changed, version), /pinned server/);
});

test('setup preflight fails without configuration and does not print identity values', () => {
  const preflight = workflow.jobs['copilot-setup-steps'].steps[0].run;
  const empty = spawnSync('bash', ['-c', preflight], {
    env: { PATH: process.env.PATH, AZURE_CLIENT_ID: '', AZURE_TENANT_ID: '', AZURE_SUBSCRIPTION_ID: '' },
    encoding: 'utf8',
  });
  assert.equal(empty.status, 1);
  assert.match(empty.stdout, /::error::Configure/);
  const present = spawnSync('bash', ['-c', preflight], {
    env: { PATH: process.env.PATH, AZURE_CLIENT_ID: 'test-client',
      AZURE_TENANT_ID: 'test-tenant', AZURE_SUBSCRIPTION_ID: 'test-subscription' },
    encoding: 'utf8',
  });
  assert.equal(present.status, 0);
  assert.equal(present.stdout, '');
});

test('tool discovery consumes every page and rejects pagination loops', async () => {
  const requests = [];
  const tools = await listAllTools({ listTools: async ({ cursor }) => {
    requests.push(cursor);
    return cursor ? { tools: [{ name: 'second' }] } :
      { tools: [{ name: 'first' }], nextCursor: 'next' };
  } });
  assert.deepEqual(tools.map(tool => tool.name), ['first', 'second']);
  assert.deepEqual(requests, [undefined, 'next']);
  await assert.rejects(listAllTools({ listTools: async () =>
    ({ tools: [], nextCursor: 'repeat' }) }), /repeated pagination/);
});

test('protocol failure and timeout remain failures, not an empty successful inventory', async () => {
  for (const message of ['Request timed out', 'Authentication required', '403 Forbidden']) {
    await assert.rejects(listAllTools({ listTools: async () => { throw new Error(message); } }),
      error => error.message === message);
  }
});

test('live inventory validation detects missing, excess and malformed tools', () => {
  const tool = { name: 'expected', inputSchema: { type: 'object', properties: { agent: {} }, required: ['agent'] },
    annotations: { readOnlyHint: true } };
  validateInventory([tool], ['expected']);
  assert.throws(() => validateInventory([], ['expected']), /does not match/);
  assert.throws(() => validateInventory([tool], []), /does not match/);
  assert.throws(() => validateInventory([{ ...tool, inputSchema: { type: 'object', required: ['missing'] } }],
    ['expected']), /missing required parameter/);
});
