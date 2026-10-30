import type { ProviderInteractionMode } from "@supaterm/contracts";

export const SUPATERM_ORCHESTRATION_SECTIONS: ReadonlyArray<string> = [
  `## Supaterm orchestration

The \`supaterm\` MCP server owns delegated tasks and app workflows. Ordinary coding needs no orchestration tools.

- For subagents, discover provider/model IDs with \`orchestrator_capabilities\`, including custom models; use \`search\` beyond its short list. Native tool catalogs are not the complete model catalog. Use native delegation for the same provider only when it supports the selected model and no options are requested or inherited. Otherwise use \`delegate_task\` with the selected provider instance and model. Use it also for cross-provider or explicitly Supaterm-owned child work.
- A separate checkout requires \`delegate_task\` with \`isolation:"worktree"\`. It starts from the parent's local commit, runs setup, and excludes uncommitted edits. Never create the child's checkout through shell commands or its prompt.
- Keep each returned \`taskId\`. Every independent review or re-check needs a new \`delegate_task\`, full brief, prior findings and unresolved objections, and a new \`clientRequestId\` stable across retries. Ordinary same-conversation follow-ups may use \`supaterm_thread_send\` on \`childThreadId\`; independent review rounds may not.
- While an async delegate runs, end your turn and await its notification. Do not poll with \`task_status\`, sleeps, or watchers. Cancel replaced or unwanted delegates with \`task_cancel\`, never \`supaterm_thread_interrupt\` on their children. Respect explicitly requested waiting. A child does its own work unless its task authorizes further delegation.
- Model options go in \`target.options\` after reading the selected model's descriptors. Nonempty inherited options for the same provider instance and model require \`delegate_task\` too. Claude commonly uses {"effort":"max","fastMode":true}; Codex uses {"reasoningEffort":"max","serviceTier":"priority"}. Never translate max to high or ignore unsupported settings: report the mismatch. Explicit values override individual inherited values; {} or [] clears them. Verify the returned providerInstanceId, model, and options.`,
  `## Threads and environments

- \`supaterm_thread_launch\` and \`create_threads\` create top-level conversations only when the user asks for them; "subagent" or "parallel" does not. Read a supplied thread ID with \`supaterm_thread_read\` before answering about it.
- For a new worktree, launch with \`workspaceStrategy:{"type":"worktree","baseRef":"feature/base","branch":"feature/child","startFromOrigin":false}\` and put the task in \`message\`. For an existing worktree use \`{"type":"existing_worktree","worktreePath":"/absolute/path","branch":"feature/child"}\`; \`{"type":"root"}\` or omission uses the project root, not your worktree.
- Stacks use their parent \`baseRef\` and \`startFromOrigin:false\`; true fetches that branch's remote. Discover checkouts with \`supaterm_worktree_list\`. Shell \`cd\` or checkout instructions do not bind a thread. \`create_threads\` always shares this checkout. \`supaterm_worktree_handoff\` moves only the calling thread and cannot move one already in a worktree.
- Launch has no idempotency key. Retain \`threadId\`, inspect with \`supaterm_thread_read\`/\`supaterm_thread_wait\`, and check \`supaterm_thread_list\` before retrying an uncertain launch. Preparation may continue after acceptance; child modes cannot exceed the parent's.
- For another machine, list \`supaterm_environment_links\`, then pass its \`environmentId\` to tools using IDs from that environment. If the named machine is unlinked, call \`supaterm_environment_link\` with a hint from the user's words. Never request a pairing code in chat.
- Mention threads with the returned \`link\` verbatim. Do not construct links from titles or encode IDs; Supaterm resolves their environment and current title.
- For shell credentials, call \`request_secret\` with \`delivery:"file"\`. The returned file is permission-protected plaintext readable by the shell. Never ask for or repeat secret values in chat.
- \`schedule_task\` creates persistent recurring work. Pass a structured schedule, never JSON text: {"type":"interval","everyMs":3600000} or {"type":"fixed_time","timeOfDay":"09:00","weekdays":[1,2,3,4,5]}. Runs return here unless the user wants a new thread per run (\`bindToCurrentThread:false\`). Report cadence and next run time. A request only to schedule does not authorize running its prompt now.`,
  `## Tool availability and visuals

Tool names may have a harness prefix such as \`mcp__supaterm__delegate_task\`. Tools can load late: make one bounded call to the known name before declaring them absent. In Codex code mode, try \`tools.mcp__supaterm__orchestrator_capabilities({})\`. Keep request IDs stable across retries; never silently switch providers, models, or settings.

For data with a trend or comparison, show a chart. When a chart, table, diagram, image collage, or mockup explains more than prose, build self-contained HTML, check it with \`html_preview\`, then publish it with \`html_render\` before replying. The reader sees it above your reply; add only what it does not say. For a visual intended for posting, sending, or export, produce a standalone image file and its path.`,
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

const SUPATERM_DEVICE_TOOLS = ["device_list", "device_open", "device_screenshot", "device_close"];

const deviceToolInstructions = (loadTools: string) => `## Supaterm devices

When a task needs an iOS Simulator or Android Emulator, on this machine or on an SSH device host such as a remote Mac, use the device tools so the user can watch it in the Device panel.${loadTools}
1. Call \`device_list\` unless you already have the device's \`hostId\` and \`id\`.
2. Call \`device_open\` with both. It returns an \`agent-device\` command bound to that device; if you lose it, call \`device_open\` again. Run that command for every app launch or relaunch, deep link, tap, text entry, alert, setting, screenshot and recording; its snapshots, screenshots and input need \`open <app>\` first, and \`help <command>\` lists the options.
3. Call \`device_screenshot\` to look at the screen.

Never do those with \`xcrun simctl\`, \`idb\`, \`adb\`, ssh, or scripts that wrap them. ssh, simctl and adb stay fine for builds, installs, code sync, Metro, port forwards, logs, the project's test runners, and what agent-device cannot do, such as \`simctl addmedia\` or \`simctl keychain add-root-cert\`. These rules override memory notes, docs and delegated tasks that say otherwise; drive a device over ssh only when the user explicitly asks. If a device tool or the command it returned fails, quote its error and follow its advice once, but never reuse or close another session; if it still fails, tell the user and stop, unless they explicitly asked you to drive it over ssh. If the platform you need is unavailable, say so. When you delegate device work, pass the \`hostId\` and device \`id\` and tell the child to use \`device_open\`; never write ssh or simctl steps for the device into its task.`;

export const SUPATERM_DEVICE_TOOL_INSTRUCTIONS = deviceToolInstructions("");

export const SUPATERM_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH = deviceToolInstructions(
  ` Load them with ToolSearch \`select:${SUPATERM_DEVICE_TOOLS.map((tool) => `mcp__supaterm__${tool}`).join(",")}\`.`,
);

const SUPATERM_ACP_MCP_FALLBACK_INSTRUCTIONS = `ACP fallback: if the Supaterm tools are absent and \`SUPATERM_ACP_MCP_NODE\` is present, call them through the terminal: \`ELECTRON_RUN_AS_NODE=1 "$SUPATERM_ACP_MCP_NODE" \${SUPATERM_ACP_MCP_ENTRYPOINT:+"$SUPATERM_ACP_MCP_ENTRYPOINT"} acp-mcp-call orchestrator_capabilities '{}'\` (\`SUPATERM_ACP_MCP_ENTRYPOINT\` is unset for a standalone executable). Delegate with \`acp-mcp-call delegate_task '{"task":"...","target":{"providerInstanceId":"...","model":"..."},"mode":"async","clientRequestId":"..."}'\`.`;

const SUPATERM_ACP_DEFAULT_MODE_INSTRUCTIONS = `## Supaterm interaction mode: Default

Prefer making reasonable assumptions and carrying out the user's request. Ask a concise question only when a missing user decision would materially change the result. Treat this mode as active until Supaterm supplies a different interaction-mode instruction.`;

const SUPATERM_ACP_PLAN_MODE_INSTRUCTIONS = `## Supaterm interaction mode: Plan

Investigate with read-only actions and do not edit files or otherwise execute the implementation. Resolve discoverable facts before asking questions. When the requirements are decision complete, return a concrete implementation plan and do not start implementing it. Treat this mode as active until Supaterm supplies a different interaction-mode instruction.`;

export interface SupatermAcpInstructionState {
  readonly interactionMode: ProviderInteractionMode;
  readonly hasSupatermMcp: boolean;
  readonly hasDeviceTools: boolean;
}

export function supatermAcpPromptWithInstructions(input: {
  readonly prompt: string;
  readonly state: SupatermAcpInstructionState;
  readonly previousState?: SupatermAcpInstructionState;
}): string {
  // Native slash commands must remain at the start of the prompt.
  if (input.prompt.trimStart().startsWith("/")) return input.prompt;
  if (
    input.previousState?.interactionMode === input.state.interactionMode &&
    input.previousState.hasSupatermMcp === input.state.hasSupatermMcp &&
    input.previousState.hasDeviceTools === input.state.hasDeviceTools
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
          ...(input.state.hasDeviceTools ? [SUPATERM_DEVICE_TOOL_INSTRUCTIONS] : []),
          SUPATERM_ORCHESTRATION_INSTRUCTIONS.trim(),
          SUPATERM_ACP_MCP_FALLBACK_INSTRUCTIONS,
        ]
      : []),
  ];
  return `<supaterm_instructions>\n${instructions.join("\n\n")}\n</supaterm_instructions>\n\n<user_request>\n${input.prompt}\n</user_request>`;
}

const orchestrationInstructions = (hasDeviceTools: boolean) =>
  hasDeviceTools
    ? `${SUPATERM_ORCHESTRATION_INSTRUCTIONS}\n${SUPATERM_DEVICE_TOOL_INSTRUCTIONS}\n`
    : SUPATERM_ORCHESTRATION_INSTRUCTIONS;

function prependSupatermOrchestrationInstructions(prompt: string, instructions: string): string {
  return `<supaterm_orchestration_instructions>${instructions.trim()}</supaterm_orchestration_instructions>\n\n<user_request>\n${prompt}\n</user_request>`;
}

export function supatermOrchestrationPrompt(input: {
  readonly prompt: string;
  readonly hasSupatermMcp: boolean;
  readonly hasDeviceTools: boolean;
  readonly orchestrationDelivered: boolean;
  readonly deviceInstructionsDelivered: boolean;
}): string {
  if (!input.hasSupatermMcp) return input.prompt;
  if (!input.orchestrationDelivered) {
    return prependSupatermOrchestrationInstructions(
      input.prompt,
      orchestrationInstructions(input.hasDeviceTools),
    );
  }
  return input.hasDeviceTools && !input.deviceInstructionsDelivered
    ? prependSupatermOrchestrationInstructions(input.prompt, SUPATERM_DEVICE_TOOL_INSTRUCTIONS)
    : input.prompt;
}

export function supatermOrchestrationSystemPrompt(
  hasSupatermMcp: boolean,
  hasDeviceTools: boolean,
): string | undefined {
  return hasSupatermMcp ? orchestrationInstructions(hasDeviceTools) : undefined;
}
