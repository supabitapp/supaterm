import { type OrchestrationV2Command, WS_METHODS } from "@supaterm/contracts";

export interface FeatureUsage {
  readonly feature: string;
  readonly variant?: string;
}

type Payload = Readonly<Record<string, unknown>>;

const literal = (payload: Payload, key: string) =>
  typeof payload[key] === "string" ? (payload[key] as string) : undefined;

const use = (feature: string, variant?: string): FeatureUsage =>
  variant === undefined ? { feature } : { feature, variant };

const COMMAND_FEATURES: {
  readonly [Type in OrchestrationV2Command["type"]]?: (
    command: Extract<OrchestrationV2Command, { readonly type: Type }>,
  ) => FeatureUsage | undefined;
} = {
  "message.dispatch": (command) =>
    command.guestMessageId === undefined ? undefined : { feature: "guest_message.send" },
  "thread.guest-share.close": () => ({ feature: "guest_share.close" }),
  "thread.guest-message.dismiss": () => ({ feature: "guest_message.dismiss" }),
  "checkpoint.rollback": (command) => ({
    feature: "checkpoint.rollback",
    variant: command.restoreFiles === false ? "conversation_only" : "with_files",
  }),
  "thread.fork": () => ({ feature: "thread.fork" }),
  "thread.merge_back": () => ({ feature: "thread.merge_back" }),
  "provider.switch": () => ({ feature: "provider.switch" }),
  "thread.archive": () => ({ feature: "thread.archive" }),
  "thread.snooze": () => ({ feature: "thread.snooze" }),
  "thread.pin": () => ({ feature: "thread.pin" }),
  "thread.message.pin": () => ({ feature: "thread.message.pin" }),
  "thread.mark-done": () => ({ feature: "thread.mark-done" }),
  "thread.pull-request.link": () => ({ feature: "thread.pull_request.link" }),
  "thread.pull-request.watch": (command) =>
    use("thread.pull_request.watch", command.watching ? "on" : "off"),
  "thread.runtime-mode.set": (command) => use("thread.runtime_mode.set", command.runtimeMode),
  "thread.interaction-mode.set": (command) =>
    use("thread.interaction_mode.set", command.interactionMode),
  "run.interrupt": () => ({ feature: "run.interrupt" }),
  "queued-message.promote-to-steer": () => ({ feature: "queue.steer" }),
  "queued-run.edit": () => ({ feature: "queue.edit" }),
};

const METHOD_FEATURES: Readonly<Record<string, (payload: Payload) => FeatureUsage>> = {
  [WS_METHODS.guestShareCreate]: () => ({ feature: "guest_share.create" }),
  [WS_METHODS.terminalOpen]: () => ({ feature: "terminal.open" }),
  [WS_METHODS.previewOpen]: () => ({ feature: "preview.open" }),
  [WS_METHODS.deviceOpen]: () => ({ feature: "device.open" }),
  [WS_METHODS.shellOpenInEditor]: (payload) => use("editor.open", literal(payload, "editor")),
  [WS_METHODS.vcsCreateWorktree]: () => ({ feature: "worktree.create" }),
  [WS_METHODS.gitRunStackedAction]: (payload) =>
    use("git.stacked_action", literal(payload, "action")),
  [WS_METHODS.pullRequestsRunAction]: (payload) =>
    use("pull_request.action", literal(payload, "action")),
  [WS_METHODS.pullRequestsSubmitReview]: () => ({ feature: "pull_request.review" }),
  [WS_METHODS.pullRequestsComment]: () => ({ feature: "pull_request.comment" }),
  [WS_METHODS.scheduledTasksUpsert]: () => ({ feature: "scheduled_task.save" }),
  [WS_METHODS.scheduledTasksRunNow]: () => ({ feature: "scheduled_task.run_now" }),
  [WS_METHODS.agentSessionsImport]: () => ({ feature: "agent_session.import" }),
  [WS_METHODS.projectCloneStart]: () => ({ feature: "project.clone" }),
  [WS_METHODS.sourceControlPublishRepository]: () => ({ feature: "repository.publish" }),
  [WS_METHODS.serverUpsertKeybinding]: () => ({ feature: "keybinding.customize" }),
};

export function commandFeatureUsage(command: OrchestrationV2Command): FeatureUsage | undefined {
  const mapping = COMMAND_FEATURES[command.type] as
    | ((command: OrchestrationV2Command) => FeatureUsage | undefined)
    | undefined;
  return mapping?.(command);
}

export function featureUsage(method: string, payload: unknown): FeatureUsage | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  return METHOD_FEATURES[method]?.(payload as Payload);
}
