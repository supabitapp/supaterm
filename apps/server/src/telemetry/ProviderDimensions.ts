import type {
  ModelSelection,
  OrchestrationV2ThreadShell,
  ServerProvider,
} from "@supaterm/contracts";

const VENDOR_CATALOG_DRIVERS: ReadonlySet<string> = new Set([
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "antigravity",
]);

export interface ProviderDimensions {
  readonly provider: string;
  readonly model?: string;
}

export function providerDimensions(
  providers: ReadonlyArray<ServerProvider>,
  selection: Pick<ModelSelection, "instanceId" | "model">,
): ProviderDimensions {
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  if (provider === undefined) return { provider: "unknown" };
  const model = provider.models.find((candidate) => candidate.slug === selection.model);
  return VENDOR_CATALOG_DRIVERS.has(provider.driver) && model !== undefined && !model.isCustom
    ? { provider: provider.driver, model: model.slug }
    : { provider: provider.driver };
}

export type AgentThread = Pick<
  OrchestrationV2ThreadShell,
  "modelSelection" | "runtimeMode" | "interactionMode" | "createdBy" | "creationSource" | "lineage"
>;

type Fields = Readonly<Record<string, unknown>>;

const asFields = (value: unknown): Fields =>
  typeof value === "object" && value !== null ? (value as Fields) : {};

const stringField = (fields: Fields, key: string) =>
  typeof fields[key] === "string" ? (fields[key] as string) : undefined;

const oneOf = (value: string | undefined, allowed: ReadonlyArray<string>) =>
  value !== undefined && allowed.includes(value) ? value : undefined;

export const crossProvider = (caller: string, target: string) =>
  caller === "unknown" || target === "unknown" ? undefined : caller !== target;

const defined = (entries: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));

export const MAX_REPORTED_DEPTH = 5;

export function callerOrigin(input: {
  readonly thread: Pick<AgentThread, "createdBy">;
  readonly scheduledRun: boolean;
}) {
  if (input.scheduledRun) return "scheduler";
  if (input.thread.createdBy === "agent") return "agent";
  return input.thread.createdBy === "system" ? "system" : "user";
}

export function handoffSettings(tool: string, args: unknown, result: unknown): Fields {
  const input = asFields(args);
  const output = asFields(result);
  switch (tool) {
    case "delegate_task":
      return defined({
        targetChosen: input.target !== undefined,
        mode: oneOf(stringField(input, "mode"), ["async", "wait"]) ?? "async",
        ...(output.waitTimedOut === true ? { waitTimedOut: true } : {}),
      });
    case "create_threads": {
      const threads = Array.isArray(input.threads) ? input.threads : [];
      return {
        batchSize: threads.length,
        targetChosen: threads.some((thread) => asFields(thread).target !== undefined),
      };
    }
    case "supaterm_thread_launch":
      return defined({
        targetChosen: input.modelSelection !== undefined,
        workspace:
          input.scratch === true
            ? "scratch"
            : (oneOf(stringField(asFields(input.workspaceStrategy), "type"), [
                "root",
                "worktree",
                "existing_worktree",
              ]) ?? "root"),
      });
    case "supaterm_thread_send":
      return defined({ delivery: stringField(output, "delivery") });
    case "supaterm_thread_send_attachments":
      return { delivery: "auto" };
    case "schedule_task":
      return { bindToCurrentThread: input.bindToCurrentThread !== false };
    default:
      return {};
  }
}

export function toolOutcome(
  result:
    | { readonly isError?: boolean | undefined; readonly structuredContent?: unknown }
    | undefined,
) {
  if (result === undefined) return { outcome: "error", errorCode: "exception" };
  const content = asFields(result.structuredContent);

  const code = stringField(content, "code") ?? stringField(asFields(content.error), "_tag");
  if (result.isError === true || (content._tag !== undefined && code !== undefined)) {
    return { outcome: "error", errorCode: code ?? "unknown" };
  }
  return { outcome: "ok" };
}

export function agentToolProperties(input: {
  readonly tool: string;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly caller: AgentThread | undefined;
  readonly callerProviderInstanceId?: ModelSelection["instanceId"];
  readonly callerDepth?: number;
  readonly callerScheduledRun?: boolean;
  readonly targets: ReadonlyArray<AgentThread>;
  readonly outcome: Fields;
  readonly settings?: Fields;
  readonly durationMs?: number;
}): ReadonlyArray<Readonly<Record<string, unknown>>> {
  const caller =
    input.caller !== undefined
      ? providerDimensions(input.providers, input.caller.modelSelection)
      : input.callerProviderInstanceId !== undefined
        ? {
            provider: providerDimensions(input.providers, {
              instanceId: input.callerProviderInstanceId,
              model: "",
            }).provider,
          }
        : { provider: "unknown" };
  const base = defined({
    tool: input.tool,
    callerProvider: caller.provider,
    callerModel: caller.model,
    callerOrigin:
      input.caller === undefined
        ? undefined
        : callerOrigin({
            thread: input.caller,
            scheduledRun: input.callerScheduledRun === true,
          }),
    callerDepth:
      input.callerDepth === undefined ? undefined : Math.min(input.callerDepth, MAX_REPORTED_DEPTH),
    durationMs: input.durationMs,
    ...input.outcome,
    ...input.settings,
  });
  if (input.targets.length === 0) return [base];
  return input.targets.map((thread) => {
    const target = providerDimensions(input.providers, thread.modelSelection);
    return defined({
      ...base,
      targetProvider: target.provider,
      targetModel: target.model,
      targetRuntimeMode: thread.runtimeMode,
      targetInteractionMode: thread.interactionMode,
      crossProvider: crossProvider(caller.provider, target.provider),
    });
  });
}
