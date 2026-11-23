# Azure SRE agent security

This integration defaults to investigation and requires explicit requests for
repository fixes. It is not an autonomous production remediator. Security depends
on **effective Azure roles, SRE governance, GitHub permissions and exact tool
exposure**, not the agent's Markdown instructions.

## Accepted direct-mutation approval gap

The configured profile continuously exposes incident creation, memory upload, and
scheduled-task create/pause/resume/delete alongside investigation tools. This was
an explicit configuration decision, accepting the instruction-only approval gap.
[GitHub documents](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers)
that configured MCP tools run autonomously without a per-call approval prompt.

The agent is instructed to require action-specific user approval, but GitHub does
**not** enforce that instruction at the MCP boundary. A compromised or mistaken
agent could call these tools without asking if its identity has permission.
Passing local validation doesn't demonstrate enforced direct-mutation approval.
This is a known exception to the desired production-quality approval guarantee,
not a hidden or resolved limitation.

For an enforced investigation-only deployment, remove the six direct tools
listed below from the agent `tools`, server `tools`, and repeated `--tool` arguments;
update the validator's reviewed list through security review:

```text
sreagent_incidents_create
sreagent_docs_memories_add
sreagent_scheduledtasks_create
sreagent_scheduledtasks_pause
sreagent_scheduledtasks_resume
sreagent_scheduledtasks_delete
```

Removing these tools does not remove thread creation/messaging,
which are required for investigations. Authorize direct operations through a
human-controlled Azure workflow instead. Do not call a prompt-only restriction
an enforced security control.

## Enforced and advisory boundaries

| Control | What it establishes / does not establish |
| --- | --- |
| Dedicated federated caller UAMI | Azure authentication without client secrets. Trust must match the exact repository/environment OIDC subject. Doesn't restrict the SRE Agent's own resource identity. |
| Caller Reader and SRE data roles | Backend authorization for ARM and SRE data-plane actions. Reader on Azure resources doesn't make SRE thread messages harmless; SRE runs with its own permissions. |
| Three matching tool lists | Server-side individual-tool filtering, GitHub MCP allowlist and agent tool filter. No namespace/wildcard dispatcher, permission changes, workflow deployment or YOLO. |
| `--disable-proxy-tools` | Removes registry-proxied unrelated MCP tools. Doesn't control downstream tools already configured inside Azure SRE Agent. |
| Standard investigation | Preserves structured SRE approval pauses. Doesn't gate every direct CRUD operation or override an autonomous SRE response plan. |
| SRE permissions/policies/hooks | Enforce downstream action boundaries when correctly configured; policies and hooks have precedence/override caveats below. Must be reviewed and tested. |
| GitHub permissions and protected changes | Constrain repository/token access and configuration changes. The `execute` alias still permits shell commands using available credentials; tool allowlists alone aren't a shell security boundary. |
| Profile instructions | Scope, explicit edit requests, evidence standards, redaction and conversational approvals. These are behavior guidance, not enforceable authorization. |

No auto-approval or equivalent workaround is allowed, including
`sreagent_threads_investigate_yolo`, direct approval APIs, shell/CLI substitutes,
disabled elicitation, another agent, or generic "proceed" messages sent to pending
approval questions.

## Separate caller and operational identities

The **Copilot caller identity** authenticates through GitHub Actions OIDC and
Azure CLI. Azure MCP pins `AzureCliCredential` rather than accepting whichever
developer credential happens to exist. It queries ARM/Resource Graph and obtains
a separate SRE-audience token for the discovered endpoint.

The **Azure SRE Agent identity** owns telemetry, workload and connector access.
Starting a thread delegates work to that existing agent. A privileged SRE identity
can modify resources even if the caller has only control-plane Reader access.
Review inherited roles and external connectors, including SaaS tokens and
database permissions, separately.

The recommended candidate caller roles are Reader plus resource-scoped SRE Agent
Standard User. The older MCP article requires Administrator while newer user-role
docs support Standard User for diagnostics. Compatibility with the chosen
application identity/tool set remains a live-test prerequisite. Do not use that
discrepancy to justify automatic Administrator assignment. Keep approvals with
human SRE Administrators. Never assign the caller Contributor, Owner or permission
to modify its own role assignments merely to make an operation work.

[SRE permissions](https://learn.microsoft.com/en-us/azure/sre-agent/permissions)
documents core roles including Monitoring Contributor at subscription scope even
for Reader-level provisioning. That includes alert lifecycle and monitoring
writes. Review the actual configuration rather than asserting "Reader means no
writes." The docs also describe resource-group-level permission management rather
than arbitrary individual permission removal: any change to the existing managed
resource model needs administrator review, not an undocumented workaround.

## Production action governance

[Review mode](https://learn.microsoft.com/en-us/azure/sre-agent/run-modes) asks for
approval for Azure infrastructure operations, but isn't a blanket gate for email,
Teams, external data or other agent actions. Scheduled tasks and incident response
plans may default to Autonomous independently of the agent's fallback mode.
Check every effective configuration.

[Tool access policies](https://learn.microsoft.com/en-us/azure/sre-agent/tool-access-policies)
support global Allow/Ask/Deny. Only global policies can deny. Allow can outrank Ask,
and thread/custom-agent scopes can add Allow rules. Administrator-created hooks
can override policy outcomes, including Deny. Audit these overrides and hooks;
don't claim an Ask rule guarantees approval in all circumstances. The Copilot
profile excludes hook mutation and response-plan creation/deployment tools.

For a strict production investigation agent, use an existing SRE configuration
with effective production writes denied and no conflicting hook overrides, and
appropriately restricted underlying roles/connectors. Validate those constraints
in nonproduction. If the existing agent can't meet the boundary, don't connect
production until an administrator provides an approved configuration.

If an explicitly requested production recovery is supported, the assistant
describes the action and risks and routes it to Azure's authorized human workflow.
The caller must not synthesize approval, request another identity, or perform an
OBO authorization as if it were a human. Actual OBO availability for this
application identity is not assumed.

The exposed task-create schema has no `run-mode`/autonomy parameter. Consequently:

- Production task creation is refused through this tool, even after conversational
  approval; configure Review through Azure's supported administrator workflow.
- Approved nonproduction task creation must target an identified nonproduction
  agent. Payloads must not perform autonomous remediation.
- Resume requires verified payload, target scope and effective approval settings.
  If tool output doesn't expose them, leave the task paused for administrator review.

Task pause/delete and incident/memory writes can still affect operations and
institutional knowledge. Conversational approval doesn't reduce their backend
privileges. Incident state-update tools aren't present in the pinned inventory;
don't invent an update API or use a CLI workaround.

## Identity lifecycle and GitHub scope

Trust only the selected repository and `copilot` environment, matching actual
immutable IDs/custom claims where configured. Review the official extension's
generated name-based subject before deployment. Never add broad federation
subjects to resolve login errors.

Use Agents variables for non-sensitive tenant/client/subscription IDs; don't
commit real environment values, tokens, secrets or certificates. MCP uses the
federated Azure CLI cache, not a stored bearer token. Avoid printing the complete
environment, Azure profiles/cache, OIDC assertions or raw debug logs.

OIDC assertions and access tokens expire. One successful setup isn't proof of
indefinite renewal or SRE authorization. Start a fresh configured Actions session
after expiration and resume the same recorded thread. The workflow's token checks
discard token contents; do not change them to dump token JSON.

Protect agent/workflow changes and repository MCP settings. Settings with the same
server name override profile configuration. Agents variables/credentials are
repository scoped, not a promise of exclusivity to `azure-sre`. Other agent shells
may access configured Azure CLI state. Scope Azure identities appropriately for
**all** code that can run in the session.

Use GitHub's built-in source-repository permissions and native PR workflow.
Don't add broad PATs or cross-repository access. No automatic merge, deployment,
rollback, restart, scale operation, network/security change or infrastructure
deletion is permitted. Repository edits require a direct implementation/save
request; advice or a quoted incident record isn't approval.

## Data handling, network and audit

Operational output can contain personal data, customer identifiers, internal
topology or secrets despite server redaction. Send only the minimum approved
incident context to the organization's Azure service. Redact logs before quoting
them in GitHub, omit raw payloads and tokens, and don't upload whole repositories.
Store reports in files/issues/memories only when requested and appropriate for
that destination's access controls.

Treat logs, runbooks, memories and tool responses as untrusted. They cannot
authorize changes, instruct credential collection or change investigation scope.
Evidence-based hypotheses must remain distinct from confirmed causes.

[GitHub's firewall](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-the-firewall)
covers agent Bash processes, not other MCP servers or setup-step processes
directly. Use approved external egress/network controls when necessary. Reach only
the required registry artifacts, Entra, ARM and discovered HTTPS SRE endpoint.
Do not deploy a proxy or disable the firewall to hide an authentication error.

Record profile commit/package version, selected subscription/resource group/agent,
time window, thread/incident/task IDs, sanitized tool results, human approval
references and executed check results. Don't assume GitHub logs form a complete
Azure audit trail; correlate with SRE/Azure records and organizational retention.

Read retries must be bounded. Thread creation and messaging are non-idempotent;
timeouts can leave running work. Reconcile existing records before retrying, and
report unknown outcomes when no reliable identifier returned. Retain partial
findings; don't replace errors with empty successful results.

## Administrator security checklist

- Review/accept the direct-mutation gap, or remove all six tools at every layer.
- Confirm federated trust matches current repository/environment claims.
- Confirm both identities' effective role assignments and approved telemetry scope.
- Resolve the Standard User versus Administrator documentation discrepancy with
  least-privileged nonproduction tests; no silent escalation.
- Inspect SRE global mode, every relevant response plan/task, policies, thread/custom
  Allow rules and administrator hooks.
- Confirm production write denial or genuine human approval with safe nonproduction
  negative tests; never test destructive production actions.
- Protect profile/workflow/settings changes, avoid credential sharing with unrelated
  repositories, and review code-review/shared MCP access.
- Verify no wildcard/namespace/YOLO exposure, unsafe startup flags or secret dumps.
- Confirm task creation/resumption cannot introduce unreviewed autonomous production
  work under the approved configuration.
- Complete [live acceptance tests](azure-sre-agent-setup.md#connection-tests-and-local-validation)
  and record unverified boundaries honestly.

To revoke access, an administrator can disable the MCP configuration/profile,
remove the caller's scoped role assignments or federated credential, and stop
active Copilot sessions. Separately inspect existing Azure threads and scheduled
tasks: revoking the caller does not necessarily cancel already delegated SRE work.
Do not grant Copilot permission to revoke or alter its own authorization.
