# Azure SRE agent examples

Select `azure-sre` in an **Actions-backed** Copilot cloud-agent session after
completing [setup](azure-sre-agent-setup.md). Replace placeholders with the intended
subscription, resource group, application, agent and timezone. When several agents
match, the assistant must ask you to select one rather than guess.

All analysis prompts leave repository content unchanged and prohibit production
actions. An investigation creates operational thread records, not just reads.
Returned evidence depends on the selected agent's actual telemetry access.

## Three quick-start prompts

```text
List accessible Azure SRE Agents in subscription <subscription>.
Do not start an investigation or modify any repository or Azure content.
If multiple agents match application <application>, show the candidates.
```

```text
Using SRE Agent <agent> in <resource-group>, subscription <subscription>,
investigate why <application> had elevated API latency during the last 30 minutes
in timezone <timezone>. State the explicit time window. Use investigation-only
mode, correlate evidence with recent deployment commits, and report observations,
hypotheses, confidence and missing data. Do not edit files or remediate production.
```

```text
Read investigation thread <thread-id> on <agent> in <resource-group>,
subscription <subscription>. If its evidence identifies a repository defect,
implement a focused fix, add regression tests, run relevant checks and open a PR.
If the root cause is unconfirmed, report the gap instead of inventing a fix.
Do not deploy, merge or modify production resources.
```

## A. Incident investigation

```text
Investigate elevated production API latency for <application> over the last
30 minutes, timezone <timezone>, using <agent> in subscription <subscription>,
resource group <resource-group>. No remediation or repository changes.
```

Expected: selected target, explicit interval, retained thread ID, impact, latency
evidence, competing causes, deployment correlation, confidence and recommendations.
No production restart, scale operation or generic approval message.

## B. Application performance

```text
Analyze the increase in HTTP 500 responses for <application> from <start> to
<end> with timezone offsets. Use <agent>, <resource-group>, <subscription>.
Distinguish application, infrastructure and dependency evidence. Inspect relevant
repository implementations and commits, but do not change anything.
```

Expected: actual error/availability/dependency evidence, implicated code when
supported, and explicit gaps where telemetry or sampling cannot distinguish causes.

## C. Deployment failure

```text
Our deployment run <run-link-or-id> failed. Investigate using <agent> in
<resource-group>, subscription <subscription>, during <start> to <end>.
Compare SRE findings with Actions logs, deployment manifests and IaC.
Recommend a fix only; no edits or deployment.
```

Expected: deployment identifiers, accessible logs/events, workflow/configuration
links and a specific recommendation. Inaccessible GitHub logs are reported, not
replaced with fabricated failures.

## D. Root cause analysis

```text
Perform an RCA for yesterday's incident affecting <application>, timezone
<timezone>. Use existing incident/thread <id> on <agent> in <resource-group>,
subscription <subscription>. Explain whether commit <sha> contributed.
Do not change records or repository content.
```

Expected: explicit dates, timeline, impact, symptoms, evidence, likely cause,
contributing factors, alternatives and preventive recommendations. A nearby commit
timestamp is not proof that the change caused the incident.

## E. Proactive reliability assessment

```text
Review <application>'s operational health over <start> to <end> using <agent>,
<resource-group>, <subscription>. Prioritize availability, error trends,
saturation, dependency failures, incidents and deployment risks.
Use observed evidence only. Do not schedule work or change resources.
```

Expected: prioritized risks with evidence, severity, confidence and missing signals.
The assistant must not interpret unavailable metrics as healthy service behavior.

## F. Infrastructure and configuration review

```text
Review this repository's Terraform, Bicep, ARM, Kubernetes and deployment
configuration for reliability issues supported by findings from <agent> in
<resource-group>, subscription <subscription>. Analyze <start> to <end>.
Separate static configuration risks from confirmed operational observations.
Do not edit or apply infrastructure.
```

Expected: file/line references, operational links, proposed IaC improvements and
risks. No application manifests currently existed in this repository at creation;
use an application repository for a meaningful correlation test.

## G. Code remediation and PR

Use the third quick-start prompt above. An explicit request permits working-branch
changes and a native GitHub PR, not a production deployment.

Expected: evidence-backed change, focused tests, executed check results, residual
uncertainty and a reviewable PR. If an Actions issue task already has a PR, use
that native workflow rather than creating duplicates. Never merge automatically.

## H. Operational knowledge retrieval

```text
What previous incidents involved <application> during <start> to <end>?
Search threads, accessible incident records and memories on <agent> in
<resource-group>, subscription <subscription>. Cite what happened and what
we learned. Do not upload memories or create incidents.
```

Expected: links/IDs, lessons and limits of the accessible historical records.
The active-incident tool isn't a complete historical incident database; supplement
it with available threads/memories, or explicitly report the history gap.

## I. Runbook guidance

```text
Read thread <thread-id> on <agent>, <resource-group>, <subscription> and recommend
an appropriate recovery runbook for <application>. Search actual repository
runbooks and accessible SRE memories. Explain prerequisites, risks and approval
requirements. Do not execute recovery actions.
```

Expected: actual runbook source, applicability, risks and human Azure approval
handoff. Product documentation from `sreagent_docs_get` is not a service runbook.

## J. Post-incident review

```text
Generate a post-incident report from thread <thread-id> on <agent> in
<resource-group>, subscription <subscription>. Include summary, timeline, impact,
detection/response, mitigation, likely cause, contributing factors and follow-ups.
Return the report in the conversation; do not save files or create issues yet.
```

Follow-up, when reviewed:

```text
Save the reviewed report to docs/incidents/<report-name>.md and create GitHub
follow-up issues for recommendations <selected-items>. Do not deploy or change
Azure operational records.
```

Expected: a report grounded in accessible records, then only the explicitly
requested file/issues. Unknown impact, timing or cause remains marked unknown.

## Continuation, approval and failures

```text
Continue reading existing thread <thread-id> on <agent>, <resource-group>,
subscription <subscription>. Retrieve partial results and remaining questions.
Do not start a replacement investigation or approve any action.
```

If authorization is pending, the assistant must preserve identifiers and direct
an authorized human to Azure. A "completed" wrapper containing pending approval
messages is not a completed investigation. After the Azure approver resolves it,
request a fresh read of the same thread.

```text
The Azure administrator resolved the approval in thread <thread-id>.
Read its fresh state on <agent>, <resource-group>, <subscription> and report
results if available. Do not send approval text or change scope.
```

Expired credentials require a fresh configured Actions session. Timeouts during
thread creation or messaging may leave running server-side work; reconcile records
instead of repeating a write. Missing access is a blocker, not permission to
use another Azure identity or broaden the tool list.

## Direct mutation examples and caveats

The deployed profile exposes selected memory, incident and scheduled-task mutation
tools by request. GitHub doesn't technically enforce the instruction requiring
approval before these direct calls. Review [security](azure-sre-agent-security.md)
before enabling this configuration in a sensitive environment.

```text
I approve uploading only this reviewed, redacted report <exact-report-content>
as memory <memory-name> on <agent> in <resource-group>, subscription <subscription>.
Do not upload other files or modify any other records.
```

```text
Read scheduled task <task-id> on <agent>, <resource-group>, <subscription>.
Explain its scope, payload and the effect of pausing it. Do not pause it yet.
```

After reviewing the details:

```text
I approve pausing scheduled task <task-id> on that selected agent.
Do not delete, resume or alter any other task.
```

For deletion, identify the same target and explicitly confirm deletion after
review. Resuming requires verified effective approval settings; if the get tool
doesn't expose enough information, an administrator must inspect Azure.
Production schedule creation is intentionally not supported through this profile's
task-create tool because its schema cannot configure Review mode. Incident
creation is a separate approved write, not an implied step in investigation;
incident state updates and response-plan changes aren't exposed.
