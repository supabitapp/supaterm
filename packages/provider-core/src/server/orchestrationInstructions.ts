import type { ProviderInteractionMode } from "@supaterm/contracts";

export const SUPATERM_ORCHESTRATION_SECTIONS: ReadonlyArray<string> = [
  `## Supaterm orchestration

Ordinary coding tasks need no Supaterm tools.

- Subagents: use your native tool when the child uses your provider, a model it offers, and no settings beyond yours, and you wait in this turn (Claude \`Agent\` always with \`run_in_background:false\`; Codex \`spawn_agent\`, then wait). Use \`delegate_task\` for another provider's model, user-asked settings, a separate checkout (\`isolation:"worktree"\`), background work, or \`delegate_task\` by name. A native type running another provider's model counts too. Workflow only when asked.
- Before \`delegate_task\`, call \`orchestrator_capabilities\` once. Again only after an error or a user-named provider change. Settings go in \`target.options\`. One child per named model. Provider or model unavailable: say so. Never switch unasked, or fall back to native tools, Workflow, or CLIs. Never make a child's checkout in the shell or in \`task\`.
- Every new delegate review or re-check is a new \`delegate_task\` (brief, findings, objections), never a \`supaterm_thread_send\`. Fix small review findings yourself; start no delegate for them. When told to proceed without a delegate, \`task_cancel\` it. Start no replacement.
- Follow a running delegate's \`next\`. Do not poll it (\`task_status\`, \`sleep\`, watchers, Monitor, ScheduleWakeup). Stop delegates with \`task_cancel\`, never \`supaterm_thread_interrupt\` on a \`childThreadId\`.
- If you are a subagent or child, do the work yourself. Start no subagents unless your task says to.`,
  `- \`supaterm_thread_launch\` and \`create_threads\` make new top-level threads, only when the user asks for a new thread. "Subagent", "delegate", and "parallel" never mean one. Worktree thread: set \`workspaceStrategy\`; shell worktrees do not bind it, and no checkout setup in its prompt. No \`workspaceStrategy\`: project root, not your worktree.
- Given a thread id, \`supaterm_thread_read\` it before you answer about it.
- In your reply, a thread's first mention is its \`link\` verbatim. No \`link\`: \`[title](supaterm-thread://v1/<exact id>)\`. Never a plain title or bare id.
- When asked only to schedule, call \`schedule_task\` without running its prompt.
- Supaterm tools may load late. Try the name once before you call it absent.`,
  `### Visuals and preview

- Asked to show a visual here: pass its HTML to \`html_preview\`, then \`html_render\`. If the visual is a file, pass that file's HTML. A screenshot on disk or a text description does not show it. Never start a server for it. Tools a web page exposes give data only. Never use them to show results. Asked for an image to post, send, or use elsewhere: a \`.png\` file and its path, never \`html_render\`.
- Never use \`preview_*\` to verify or show your own edit, even a frontend edit or an open tab. Do not repeat preview calls from an earlier turn. Use them only when the current request asks for browser work or names a page or tab. Public pages: web fetch or search unless browser work was asked; then preview tools only, no web fetch. Close a tab you opened before you reply, unless the user asked for it or uses it.`,
];

export const SUPATERM_ORCHESTRATION_INSTRUCTIONS = `

${SUPATERM_ORCHESTRATION_SECTIONS.join("\n\n")}
`;

export const SUPATERM_BROWSER_TOOL_INSTRUCTIONS = `

## Supaterm browser

When browser work was asked, \`preview_*\` is the browser you share with the user: \`preview_status\` first, then \`preview_open\` if no tab can be automated. Prefer snapshot locators over coordinates. Switch browsers only if the tools are absent or \`preview_open\` says unsupported, the user asks, or two preview calls fail on one step. Then quote the error and switch.
`;

// ACP only: some ACP agents accept the injected MCP server but never expose
// its tools, so they need the terminal transport other harnesses never use.
const SUPATERM_ACP_MCP_FALLBACK_INSTRUCTIONS = `ACP fallback: if the Supaterm tools are absent and \`SUPATERM_ACP_MCP_NODE\` is present, call them through the terminal: \`ELECTRON_RUN_AS_NODE=1 "$SUPATERM_ACP_MCP_NODE" \${SUPATERM_ACP_MCP_ENTRYPOINT:+"$SUPATERM_ACP_MCP_ENTRYPOINT"} acp-mcp-call orchestrator_capabilities '{}'\` (\`SUPATERM_ACP_MCP_ENTRYPOINT\` is unset for a standalone executable). Delegate with \`acp-mcp-call delegate_task '{"task":"...","target":{"providerInstanceId":"...","model":"..."},"mode":"async","clientRequestId":"..."}'\`.`;

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
      ? [
          SUPATERM_BROWSER_TOOL_INSTRUCTIONS.trim(),
          SUPATERM_ORCHESTRATION_INSTRUCTIONS.trim(),
          SUPATERM_ACP_MCP_FALLBACK_INSTRUCTIONS,
        ]
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
