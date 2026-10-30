// Embedded so desktop bundles and standalone executables carry the same skills.
export const ORCHESTRATION_SKILLS = [
  {
    name: "supaterm-commitee",
    description:
      "Form a committee of two high-reasoning agents to step back, do root cause analysis, and produce a plan. Use when stuck, looping, tunnel-visioning, or facing a hard planning problem.",
    content: `---
name: supaterm-commitee
description: Form a committee of two high-reasoning agents to step back, do root cause analysis, and produce a plan. Use when stuck, looping, tunnel-visioning, or facing a hard planning problem.
license: Apache-2.0
---

# Committee Skill

<!-- Modified for Supaterm orchestration. -->

Two agents from contrasting providers, fresh context, planning a solution in parallel.

**User's additional context:** $ARGUMENTS

## Prerequisites

Read the [Supaterm orchestration reference](references/orchestration.md). Call \`orchestrator_capabilities\` before choosing committee members. Do not create committee agents until you have read the configured providers, their models, and their constraints.

Contrast is the point of a committee, so pick models from different provider families when possible. Materialize each provider and model into \`delegate_task\`.

## Composition

Two members with different reasoning styles, selected from configured providers and models:

- one whose model fits planning, research, or root-cause analysis
- one contrasting high-reasoning model from another provider family

If the user names providers or models, use those. If fewer than two suitable provider families are configured, use another available model for the missing member and tell the user. Override the selection only when the user explicitly asks for different members.

## Hard rules

- **No edits.** Every prompt to a committee member ends with the no-edits suffix:

  \`\`\`
  This is analysis only. Do NOT edit, create, or delete any files. Do NOT write code.
  \`\`\`

- **Trust the finish notification.** Do not poll, send hurry-ups, or interrupt. Models can reason for 15–30 minutes. You can go idle and Supaterm will notify you.

## Workflow

1. Write a problem-level prompt
2. Create both agents in parallel via Supaterm with \`delegate_task\`, \`[Committee] <task>\` titles, and the same prompt
3. Wait for both responses, then read them with \`task_status\`
4. Resolve disagreements by passing their arguments between each other through fresh \`delegate_task\` calls, as described by the orchestration reference
5. Keep going until they converge into a response

Share the consensus with the user. Summarize where the agents diverged and how they resolved it.
`,
  },
  {
    name: "supaterm-advisor",
    description:
      'Spin up a single agent as an advisor \u2014 second opinion on the current task. Use when the user says "advisor", "second opinion", "what does X think", or wants an outside take without delegating the work itself.',
    content: `---
name: supaterm-advisor
description: Spin up a single agent as an advisor — second opinion on the current task. Use when the user says "advisor", "second opinion", "what does X think", or wants an outside take without delegating the work itself.
license: Apache-2.0
---

# Supaterm Advisor

<!-- Modified for Supaterm orchestration. -->

Single agent. Reads the situation you're in. Gives a judgment. You decide what to do — the advisor doesn't drive the work.

**User's request:** $ARGUMENTS

## Prerequisites

Read the [Supaterm orchestration reference](references/orchestration.md). Call \`orchestrator_capabilities\` before choosing the advisor. Do not create the advisor until you have read the configured providers, their models, and their constraints.

## Picking the advisor

1. **User named a provider or model** (\`--provider <id>\`, \`--model <id>\`) → select it by its advertised ID.
2. **Otherwise** choose the model that best fits the question. Match the actual work: design and approach, audit and review, or research and root-cause analysis.
3. **Contrast helps.** When several models fit, prefer a different provider family from your own so the second opinion is genuinely fresh.

Materialize the selected provider and model into \`delegate_task\` as described by the orchestration reference.

## The briefing

The advisor has zero context. Make it self-contained:

- The question, sharply.
- What you've considered and what you've ruled out.
- Relevant files by path (don't paste — let the agent read).
- Explicit ask: "give me a recommendation, with reasoning."

End with the no-edits suffix:

\`\`\`
This is analysis only. Do NOT edit, create, or delete any files. Do NOT write code.
\`\`\`

## Forwarded skills

If \`$ARGUMENTS\` contains another skill reference — \`/unslop\`, \`/unslop-risk\`, \`$unslop\`, etc. — the user is asking the advisor to run that skill against the current task. Examples:

- \`/supaterm-advisor /unslop\` → advisor runs \`/unslop\` on the current diff.
- \`/supaterm-advisor /unslop-risk\` → advisor does an unslop-risk review.
- \`/supaterm-advisor $diagnose this build failure\` → advisor invokes \`/diagnose\`.

Parse the forwarded skill name out of \`$ARGUMENTS\` (\`/<name>\` or \`$<name>\`). In the briefing, tell the advisor explicitly:

\`\`\`
Invoke the \`<name>\` skill against this task. Load it via the Skill tool, or read its \`SKILL.md\`, before doing anything else.
\`\`\`

Pass through any remaining arguments after the skill name as the skill's own input. The advisor — not you — runs the skill; you're still just the orchestrator handing it the work.

## Launch and synthesize

Create the advisor agent via Supaterm with \`delegate_task\`, a \`[Advisor] <topic>\` title, and the briefing as \`task\`. Wait for it to finish. Read its response. Synthesize for the user — the advisor's verdict + your recommendation.

## Persistent advisor

If the user wants ongoing input ("keep this advisor for the next few decisions"), keep the selected provider and model after the first reply. Request follow-ups when you need another take, using a fresh \`delegate_task\` with the original brief and prior responses as described by the orchestration reference. Stop when the user says they're done, or when the topic shifts and a fresh context would serve better.
`,
  },
] as const;

export const ORCHESTRATION_SKILL_REFERENCE = `# Supaterm orchestration

Use the user's invocation as \`$ARGUMENTS\` when the harness does not substitute it. Supaterm supplies provider instances and models instead of agent profiles.

## Select a target

Call \`orchestrator_capabilities\`. Confirm \`features.appOwnedSubagents\`, then select a provider with \`canRunChildTask = true\` and respect its \`constraints\`. Cross-provider choices require \`canRunCrossProviderChildTask = true\`.

Use the returned \`providerInstanceId\` and a model ID from that provider's \`models\`. Set reasoning options through \`target.options\` using the model's advertised option IDs and allowed values. If a named target is unavailable, tell the user rather than silently substituting.

## Delegate and receive

Call \`delegate_task\` with \`task\`, \`title\`, \`target: { providerInstanceId, model, options? }\`, \`mode: "async"\`, and a \`clientRequestId\`. Retain the returned \`taskId\`. Use a distinct request ID for each member and round, stable across retries of that request.

These are Supaterm-owned child tasks. \`create_threads\` and \`supaterm_thread_launch\` create top-level conversations; the returned \`childThreadId\` is backing storage for the child.

An async completion notification wakes the parent. End the turn when waiting and resume on notification. Call \`task_status\` with the retained task ID to read \`summary\`. Reading a terminal result acknowledges delivery. \`workState: "waiting_for_children"\` means nested work is still pending; wait for \`workState: "result_available"\` and a terminal status.

Each follow-up or review round needs a fresh \`delegate_task\`. Include the original brief, prior findings, responses, and unresolved objections. Do not continue delegated review with \`supaterm_thread_send\` on \`childThreadId\`.

## Tool availability

Tool names can have a harness prefix such as \`mcp__supaterm__delegate_task\`. If the initial tool catalog omits Supaterm, make one bounded discovery or direct invocation attempt. In Codex code mode, call \`tools.mcp__supaterm__orchestrator_capabilities({})\`.

When MCP tools remain unavailable and \`SUPATERM_ACP_MCP_NODE\` is present, use the supported terminal transport:

\`\`\`sh
ELECTRON_RUN_AS_NODE=1 "$SUPATERM_ACP_MCP_NODE" \${SUPATERM_ACP_MCP_ENTRYPOINT:+"$SUPATERM_ACP_MCP_ENTRYPOINT"} acp-mcp-call orchestrator_capabilities '{}'
\`\`\`

Call the other tools through the same launcher with their tool name and JSON arguments. If neither transport works, report that Supaterm orchestration is unavailable.

The contract is defined by Supaterm's [tool definitions](https://github.com/supabitapp/supaterm/blob/6331199f7/apps/server/src/mcp/toolkits/orchestrator/tools.ts), [schemas](https://github.com/supabitapp/supaterm/blob/6331199f7/packages/contracts/src/orchestratorMcp.ts), and [provider instructions](https://github.com/supabitapp/supaterm/blob/6331199f7/apps/server/src/provider/SupacodeOrchestrationInstructions.ts). Use the live tool schemas when they change.
`;
