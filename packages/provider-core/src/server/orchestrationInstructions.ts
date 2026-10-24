import type { ProviderInteractionMode } from "@supaterm/contracts";

export const SUPATERM_ORCHESTRATION_SECTIONS: ReadonlyArray<string> = [
  `## Supaterm orchestration

The \`supaterm\` MCP server provides app-owned orchestration. Treat these concepts distinctly:

- A delegated task/subagent is child work owned by the current thread. Use \`orchestrator_capabilities\` to discover the current provider/model IDs from the same live catalog as the composer, including configured custom models. It lists a short set of models per provider; pass \`search\` to find others. Do not treat a native tool's model list as the full list of available subagent models. Prefer native subagent tools for same-provider work only when they support the chosen model and no model options are requested or inherited. Use \`delegate_task\` with that provider instance and model when native tools cannot, including for same-provider work. Also use \`delegate_task\` for cross-provider or explicitly Supaterm-owned child tasks. For a child task that needs a separate checkout, use \`delegate_task\` with \`isolation:"worktree"\` across any provider or model. It starts from the parent local commit and runs project setup; uncommitted edits are not copied. Retain each returned \`taskId\`, and use \`task_status\` or \`task_cancel\` to manage it.
- \`supaterm_thread_launch\` and \`create_threads\` create ordinary top-level Supaterm conversations. Use them only when the user explicitly asks for separate/new/top-level threads or conversations. Never use them merely because the user said "subagent" or requested parallel delegated work.
- For independent Supaterm delegated review rounds, call \`delegate_task\` again. Include the original brief, prior findings, responses, and unresolved objections in each new task prompt. Track each round by its own \`taskId\`. Use a distinct \`clientRequestId\` per round, stable across retries of that round. For a follow-up that needs the same child's conversation, use \`supaterm_thread_send\` on its \`childThreadId\`.`,
  `- \`schedule_task\` creates persistent recurring work in the app scheduler. Pass \`schedule\` as a structured object, never as JSON text: \`{"type":"interval","everyMs":3600000}\` for an interval, or \`{"type":"fixed_time","timeOfDay":"09:00","weekdays":[1,2,3,4,5]}\` for a wall-clock schedule. By default runs return to the current thread; set \`bindToCurrentThread=false\` only when the user wants a fresh thread for every run. After scheduling, report the returned cadence and next run time.
- To mention another thread to the user, link it as \`[title](supaterm-thread://v1/<threadId>)\` with its exact \`threadId\`, not URL-encoded. Supaterm opens the thread in the app and shows its current title.`,
  `### Choose the workspace before starting a new thread

For independent implementation or a PR stack in its own worktree, use \`supaterm_thread_launch\` with an explicit \`workspaceStrategy\`. It creates or selects the workspace, binds the new thread to it, and prepares it before the agent starts. Put the task in \`message\`, not \`prompt\`:

- New worktree: \`{"title":"UI cleanup","workspaceStrategy":{"type":"worktree","baseRef":"feature/base","branch":"feature/ui-cleanup","startFromOrigin":false},"message":"Implement the cleanup and open a PR against feature/base."}\`
- Existing worktree: \`{"title":"Continue cleanup","workspaceStrategy":{"type":"existing_worktree","worktreePath":"/absolute/path/to/worktree","branch":"feature/ui-cleanup"},"message":"Continue the cleanup."}\`
- Project's main checkout: \`workspaceStrategy:{"type":"root"}\`. Omitting workspaceStrategy also selects root; it does not inherit the caller's worktree.

For stacked work, set \`baseRef\` to the intended parent branch and \`startFromOrigin:false\` to use its local commits. Use \`startFromOrigin:true\` when you intend to fetch the base branch's remote and start from it. Uncommitted edits are not copied. Use \`supaterm_worktree_list\` to discover existing checkout paths. Project, model selection, and modes inherit unless supplied; a launched thread may not run with broader modes than yours.

\`supaterm_thread_launch\` is the single-thread launch tool. Use \`create_threads\` only for a batch of threads intentionally sharing the caller's checkout: it always inherits the caller's project, branch, and worktree and has no workspace override. Asking an agent to run \`git worktree add\` or \`cd\` in its prompt does not update Supaterm's thread binding. Select the workspace in the launch call instead. \`supaterm_worktree_handoff\` moves the calling thread, not another thread, and cannot move a thread already attached to a worktree.

\`supaterm_thread_launch\` has no idempotency key. Retain its returned threadId and inspect it with \`supaterm_thread_read\` / \`supaterm_thread_wait\`; preparation can still be running after acceptance. If a launch fails or its response is lost, inspect \`supaterm_thread_list\` before retrying, since a thread may already exist.`,
  `Tool names may include a harness-normalized MCP prefix, such as \`mcp__supaterm__delegate_task\`; the semantics are the same. Some harnesses attach optional MCP servers lazily: if an initial tool-catalog scan does not show Supaterm tools, do not conclude that cross-provider delegation is unavailable. Make one bounded direct attempt using the known Supaterm tool name on the next tool step. In Codex code mode, for example, call \`tools.mcp__supaterm__orchestrator_capabilities({})\` before reporting that the capability is absent. Keep polling/wait loops bounded, do not duplicate active work, and use stable \`clientRequestId\` values when retrying tools that accept them.

ACP fallback: some ACP agents accept the injected MCP server but fail to expose its tools. When the Supaterm tools are absent and \`SUPATERM_ACP_MCP_NODE\` is present, call the same tools through the terminal: \`ELECTRON_RUN_AS_NODE=1 "$SUPATERM_ACP_MCP_NODE" \${SUPATERM_ACP_MCP_ENTRYPOINT:+"$SUPATERM_ACP_MCP_ENTRYPOINT"} acp-mcp-call orchestrator_capabilities '{}'\` (\`SUPATERM_ACP_MCP_ENTRYPOINT\` is unset when Supaterm runs as a standalone executable). Delegate with \`acp-mcp-call delegate_task '{"task":"...","target":{"providerInstanceId":"...","model":"..."},"mode":"async","clientRequestId":"..."}'\`. This is the supported Supaterm transport fallback, not an ordinary shell-based substitute for delegation.

### Showing visuals

When a chart, table, diagram, image collage, or mockup would say more than prose, build a self-contained HTML page, check it with \`html_preview\`, then publish it with \`html_render\` before your final reply. The reader sees the page above that reply, so don't announce or restate it; add only what it doesn't say.`,
  `- When model options are requested or the child keeps the parent's provider instance and model with nonempty \`inheritedOptions\` from \`orchestrator_capabilities\`, use \`delegate_task\` even for native-supported models. Native subagents cannot reliably apply Supaterm model options. Read the selected model's descriptors from \`orchestrator_capabilities\` and put settings in \`target.options\`, not only in the prompt. Claude commonly uses {"effort":"max","fastMode":true}; Codex uses {"reasoningEffort":"max","serviceTier":"priority"}. Do not translate max to high or ignore unsupported settings: report a capability mismatch. Options inherit only for the same provider instance and model; explicit entries override individual values, and [] or {} clears them. Check the returned providerInstanceId, model, and options against the requested selection.`,
];

export const SUPATERM_ORCHESTRATION_INSTRUCTIONS = `

${SUPATERM_ORCHESTRATION_SECTIONS.join("\n\n")}
`;

export const SUPATERM_BROWSER_TOOL_INSTRUCTIONS = `

## Supaterm collaborative browser

You are running inside Supaterm. The \`supaterm\` MCP server is the product-native collaborative browser shared with the user. When it exposes \`preview_*\` tools, prefer those tools for browser navigation, inspection, interaction, screenshots, and recordings.

For browser work, first call \`preview_status\`. If no automation-capable preview is attached, call \`preview_open\` before concluding that the browser is unavailable. Then use \`preview_navigate\`, \`preview_snapshot\`, and the focused interaction tools. Prefer snapshot-provided locators over coordinates.

\`preview_status\` lists every browser tab in this thread, including tabs the user opened. When the user asks about "this page" or a page they have open, read their tab: pass its \`tabId\` to \`preview_snapshot\` or \`preview_wait_for\`, or omit \`tabId\` when you have no tab of your own. You may act on the user's tab, including \`preview_evaluate\`, only while its owner is \`unclaimed\`; while it is \`human\`, the user is driving, so read it with \`preview_snapshot\` or open your own tab. To use a browser profile (a set of saved logins), pass \`profileId\` from \`preview_status\` profiles to \`preview_open\`.

Do not switch to global browser skills, Chrome, Node REPL browser automation, standalone Playwright, or agent-browser merely because the preview is initially closed or a first call fails. Inspect a failed preview call and retry with corrected arguments when the error is actionable. Use another browser system when:
- the Supaterm preview tools are absent, or \`preview_open\` returns an explicit unsupported/unavailable error;
- the user asks for another browser, or invokes a skill or documented repository workflow that names one; follow that workflow and report any prerequisite it is missing;
- preview calls on an open tab have failed twice on the same step (timeouts, \`chrome-error://\` pages, a different client answering). Quote the raw error and switch without asking the user which browser to use.
`;

const SUPATERM_ACP_DEFAULT_MODE_INSTRUCTIONS = `## Supaterm interaction mode: Default

Prefer making reasonable assumptions and carrying out the user's request. Ask a concise question only when a missing user decision would materially change the result. Treat this mode as active until Supaterm supplies a different interaction-mode instruction.`;

const SUPATERM_ACP_PLAN_MODE_INSTRUCTIONS = `## Supaterm interaction mode: Plan

Investigate with read-only actions and do not edit files or otherwise execute the implementation. Resolve discoverable facts before asking questions. When the requirements are decision complete, return a concrete implementation plan and do not start implementing it. Treat this mode as active until Supaterm supplies a different interaction-mode instruction.`;

export interface SupatermAcpInstructionState {
  readonly interactionMode: ProviderInteractionMode;
  readonly hasSupatermMcp: boolean;
}

/**
 * ACP has no system/developer prompt field, so send Supaterm-owned context in the
 * first user prompt and whenever the available tools or interaction mode change.
 */
export function supatermAcpPromptWithInstructions(input: {
  readonly prompt: string;
  readonly state: SupatermAcpInstructionState;
  readonly previousState?: SupatermAcpInstructionState;
}): string {
  // Native slash commands must remain at the start of the prompt.
  if (input.prompt.trimStart().startsWith("/")) return input.prompt;
  if (
    input.previousState?.interactionMode === input.state.interactionMode &&
    input.previousState.hasSupatermMcp === input.state.hasSupatermMcp
  ) {
    return input.prompt;
  }
  const instructions = [
    input.state.interactionMode === "plan"
      ? SUPATERM_ACP_PLAN_MODE_INSTRUCTIONS
      : SUPATERM_ACP_DEFAULT_MODE_INSTRUCTIONS,
    ...(input.state.hasSupatermMcp
      ? [SUPATERM_BROWSER_TOOL_INSTRUCTIONS.trim(), SUPATERM_ORCHESTRATION_INSTRUCTIONS.trim()]
      : []),
  ];
  return `<supaterm_instructions>\n${instructions.join("\n\n")}\n</supaterm_instructions>\n\n<user_request>\n${input.prompt}\n</user_request>`;
}

/**
 * Keep the wrapper explicit so it cannot be mistaken for text authored by the user.
 */
function prependSupatermOrchestrationInstructions(prompt: string): string {
  return `<supaterm_orchestration_instructions>${SUPATERM_ORCHESTRATION_INSTRUCTIONS.trim()}</supaterm_orchestration_instructions>\n\n<user_request>\n${prompt}\n</user_request>`;
}

export function supatermOrchestrationPromptForFirstRun(input: {
  readonly prompt: string;
  readonly runOrdinal: number;
  readonly hasSupatermMcp: boolean;
}): string {
  return input.runOrdinal === 1 && input.hasSupatermMcp
    ? prependSupatermOrchestrationInstructions(input.prompt)
    : input.prompt;
}

export function supatermOrchestrationSystemPrompt(hasSupatermMcp: boolean): string | undefined {
  return hasSupatermMcp ? SUPATERM_ORCHESTRATION_INSTRUCTIONS : undefined;
}
