import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const serverName = 'azure-sre-mcp';
const approvedTools = new Set([
  'sreagent_agents_list', 'sreagent_agents_get',
  'sreagent_threads_create', 'sreagent_threads_list', 'sreagent_threads_get',
  'sreagent_threads_send_message', 'sreagent_threads_investigate',
  'sreagent_incidents_active_list', 'sreagent_incidents_plans_list',
  'sreagent_incidents_create', 'sreagent_docs_get',
  'sreagent_docs_memories_list', 'sreagent_docs_memories_search',
  'sreagent_docs_memories_add', 'sreagent_commonprompts_list',
  'sreagent_commonprompts_get', 'sreagent_scheduledtasks_list',
  'sreagent_scheduledtasks_get', 'sreagent_scheduledtasks_create',
  'sreagent_scheduledtasks_pause', 'sreagent_scheduledtasks_resume',
  'sreagent_scheduledtasks_delete',
]);

export function parseYaml(text) {
  const doc = parseDocument(text, { uniqueKeys: true });
  assert.equal(doc.errors.length, 0, doc.errors.map(error => error.message).join('\n'));
  return doc.toJS({ maxAliasCount: 0 });
}

export function parseProfile(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/);
  assert.ok(match, 'Agent needs YAML frontmatter and a nonempty prompt');
  assert.ok(match[2].length <= 30000, 'Agent prompt exceeds GitHub limit');
  return parseYaml(match[1]);
}

function uniqueStrings(values, label) {
  assert.ok(Array.isArray(values) && values.every(v => typeof v === 'string'), `${label} must be a string array`);
  assert.equal(new Set(values).size, values.length, `${label} contains duplicate entries`);
  return new Set(values);
}

export function validateProfile(profile, version) {
  const fields = new Set(['name', 'description', 'target', 'tools', 'mcp-servers',
    'disable-model-invocation', 'user-invocable']);
  assert.ok(Object.keys(profile).every(key => fields.has(key)), 'Unsupported/unreviewed agent property');
  assert.equal(profile.name, 'azure-sre');
  assert.ok(typeof profile.description === 'string' && profile.description.length > 0);
  assert.equal(profile.target, 'github-copilot');
  assert.equal(profile['disable-model-invocation'], true);
  assert.equal(profile['user-invocable'], true);
  assert.deepEqual(Object.keys(profile['mcp-servers'] ?? {}), [serverName], 'Only the reviewed MCP server is allowed');
  const server = profile['mcp-servers'][serverName];
  assert.deepEqual(new Set(Object.keys(server)), new Set(['type', 'command', 'args', 'tools', 'env']));
  assert.equal(server.type, 'local');
  assert.equal(server.command, 'npx');
  assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.]+)?$/, 'Azure MCP version must be pinned');
  assert.deepEqual(server.env, { AZURE_TOKEN_CREDENTIALS: 'AzureCliCredential' });
  const tools = uniqueStrings(server.tools, 'MCP tools');
  assert.deepEqual(tools, approvedTools, 'MCP tools differ from reviewed least-privilege list');
  const args = ['-y', `@azure/mcp@${version}`, 'server', 'start', '--disable-proxy-tools',
    ...server.tools.flatMap(tool => ['--tool', tool])];
  assert.deepEqual(server.args, args, 'Startup must expose only the reviewed individual tools');
  const agentTools = uniqueStrings(profile.tools, 'Agent tools');
  assert.deepEqual(agentTools, new Set(['read', 'search', 'edit', 'execute',
    ...server.tools.map(tool => `${serverName}/${tool}`)]), 'Agent/server allowlists differ');
  return server;
}

export function validateWorkflow(workflow, version) {
  assert.deepEqual(Object.keys(workflow.on ?? {}), ['workflow_dispatch'],
    'Do not run identity setup on untrusted PR/push events');
  const inputs = workflow.on.workflow_dispatch?.inputs;
  assert.deepEqual(Object.keys(inputs ?? {}), ['resource_group', 'agent_name', 'create_test_thread']);
  for (const name of ['resource_group', 'agent_name']) {
    assert.equal(inputs[name].type, 'string');
    assert.equal(inputs[name].required, false);
  }
  assert.equal(inputs.create_test_thread.type, 'boolean');
  assert.equal(inputs.create_test_thread.required, false);
  assert.equal(inputs.create_test_thread.default, false);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs ?? {}), ['copilot-setup-steps']);
  const job = workflow.jobs['copilot-setup-steps'];
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job.environment, 'copilot');
  assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 59);
  assert.deepEqual(job.permissions, { contents: 'read', 'id-token': 'write' });
  const validation = job.steps[0];
  assert.equal(validation.shell, 'bash');
  assert.equal(validation.id, 'identity');
  const variables = ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID'];
  assert.deepEqual(validation.env, Object.fromEntries(variables.map(name => [`ACTIONS_${name}`, `\${{ vars.${name} }}`])));
  assert.ok(validation.run.includes('exit 1') && validation.run.includes('set -euo pipefail'));
  const setup = job.steps.find(step => step.uses?.startsWith('actions/setup-node@'));
  assert.ok(setup, 'Node.js 22+ setup required');
  assert.match(setup.uses, /^actions\/setup-node@[a-f0-9]{40}$/);
  assert.equal(setup.with['node-version'], '22');
  const login = job.steps.find(step => step.uses?.startsWith('azure/login@'));
  assert.ok(login, 'Federated Azure login is required');
  assert.match(login.uses, /^azure\/login@[a-f0-9]{40}$/);
  assert.deepEqual(login.with, {
    'client-id': '${{ steps.identity.outputs.client_id }}',
    'tenant-id': '${{ steps.identity.outputs.tenant_id }}',
    'subscription-id': '${{ steps.identity.outputs.subscription_id }}',
  }, 'Only non-secret OIDC identity values are permitted');
  assert.ok(job.steps.every(step => !step['continue-on-error']), 'Setup must not hide authentication failures');
  assert.equal(job.steps.length, 5, 'Unreviewed setup step');
  const tokens = job.steps[3];
  assert.ok(tokens.run.includes('https://management.azure.com/') &&
    tokens.run.includes('59f0a04a-b322-4310-adc9-39ac41e9631e') &&
    tokens.run.includes('--query expiresOn'), 'Check both token audiences without printing tokens');
  const live = job.steps[4];
  assert.equal(live.if, "${{ github.event_name == 'workflow_dispatch' && (inputs.resource_group != '' || inputs.agent_name != '' || inputs.create_test_thread) }}");
  assert.equal(live.shell, 'bash');
  assert.deepEqual(live.env, {
    AZURE_TOKEN_CREDENTIALS: 'AzureCliCredential',
    AZURE_SUBSCRIPTION_ID: '${{ steps.identity.outputs.subscription_id }}',
    SRE_RESOURCE_GROUP: '${{ inputs.resource_group }}',
    SRE_AGENT_NAME: '${{ inputs.agent_name }}',
    SRE_CREATE_TEST_THREAD: '${{ inputs.create_test_thread }}',
  });
  assert.ok(live.run.includes(`@azure/mcp@${version} sreagent agents list`) &&
    live.run.includes(`@azure/mcp@${version} sreagent threads list`) &&
    live.run.includes(`@azure/mcp@${version} sreagent threads create`) &&
    live.run.includes(`@azure/mcp@${version} sreagent threads get`) &&
    !live.run.includes('${{ inputs.'), 'The manual check must use the pinned server and quoted input environment variables');
}

export async function listAllTools(client) {
  const tools = [];
  const cursors = new Set();
  let cursor;
  do {
    const result = await client.listTools(cursor ? { cursor } : {}, { timeout: 60000 });
    tools.push(...result.tools);
    cursor = result.nextCursor;
    if (cursor) {
      assert.ok(!cursors.has(cursor), 'MCP returned a repeated pagination cursor');
      cursors.add(cursor);
    }
  } while (cursor);
  uniqueStrings(tools.map(tool => tool.name), 'Discovered tools');
  return tools;
}

export function validateInventory(tools, expectedNames) {
  assert.deepEqual(new Set(tools.map(tool => tool.name)), new Set(expectedNames),
    'Live MCP inventory does not match configuration');
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object', `${tool.name}: missing object input schema`);
    assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', `${tool.name}: missing read-only annotation`);
    for (const key of tool.inputSchema.required ?? []) {
      assert.ok(Object.hasOwn(tool.inputSchema.properties ?? {}, key), `${tool.name}: missing required parameter ${key}`);
    }
  }
}

async function discover(server, version) {
  const client = new Client({ name: 'azure-sre-validation', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: server.command, args: server.args, cwd: root,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
      ...server.env },
    stderr: 'pipe',
  });
  // Drain server diagnostics, but do not print potentially sensitive contents.
  transport.stderr?.on('data', () => {});
  try {
    await client.connect(transport, { timeout: 60000 });
    assert.equal(client.getServerVersion()?.version, version, 'Unexpected server version');
    return { server: client.getServerVersion(), tools: await listAllTools(client) };
  } finally {
    await client.close();
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const version = manifest.devDependencies['@azure/mcp'];
  const profile = parseProfile(await readFile(resolve(root, '.github/agents/azure-sre.agent.md'), 'utf8'));
  const server = validateProfile(profile, version);
  validateWorkflow(parseYaml(await readFile(resolve(root, '.github/workflows/copilot-setup-steps.yml'), 'utf8')), version);
  const mode = process.argv[2];
  assert.ok([undefined, '--mcp', '--inventory'].includes(mode), 'Use --mcp or --inventory');
  if (mode === '--inventory') {
    const inventory = await discover({
      command: 'npx',
      args: ['-y', `@azure/mcp@${version}`, 'server', 'start',
        '--namespace', 'sreagent', '--mode', 'all', '--disable-proxy-tools'],
      env: server.env,
    }, version);
    assert.ok(inventory.tools.every(tool => tool.name.startsWith('sreagent_')));
    validateInventory(inventory.tools, inventory.tools.map(tool => tool.name));
    const setup = await readFile(resolve(root, 'docs/azure-sre-agent-setup.md'), 'utf8');
    const rows = [...setup.matchAll(/^\| `(sreagent_[^`]+)` \| ([^|]+) \| [^|]+ \|$/gm)];
    assert.equal(rows.length, inventory.tools.length, 'Documented inventory count differs');
    assert.deepEqual(new Set(rows.map(row => row[1])), new Set(inventory.tools.map(tool => tool.name)),
      'Documented inventory names differ');
    for (const [, name, required] of rows) {
      const tool = inventory.tools.find(tool => tool.name === name);
      assert.equal(required.trim(), (tool.inputSchema.required ?? []).join(', ') || 'none',
        `${name}: documented required parameters differ`);
    }
    process.stdout.write(`${JSON.stringify({ package: '@azure/mcp', version, ...inventory }, null, 2)}\n`);
  } else if (mode === '--mcp') {
    const inventory = await discover(server, version);
    validateInventory(inventory.tools, server.tools);
    console.log(`PASS: profile/workflow and real ${inventory.server.name} ${version} initialization; ${inventory.tools.length} exact allowed tools. No Azure operations executed.`);
  } else {
    console.log('PASS: reviewed profile, tool allowlists and OIDC workflow configuration.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
