import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface AgentScopeShape {
  readonly wrap: (input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly name: string;
    readonly threadId?: string | undefined;
    readonly sessionId?: string | undefined;
    readonly env?: NodeJS.ProcessEnv | undefined;
    /** Terminals may survive restarts; agents must remain eligible for orphan cleanup. */
    readonly survivesRestart?: boolean | undefined;
    readonly shared?: boolean | undefined;
  }) => Effect.Effect<AgentScopeCommand>;
  readonly oomKilled: (threadId: string, sessionId?: string) => Effect.Effect<boolean>;
  /**
   * Forgets the thread's scope. The session manager calls it before it opens
   * a provider session, so a scope only answers for the session that launched
   * it, even when the next session runs without one (Cursor, OpenCode).
   */
  readonly clear: (threadId: string, sessionId?: string) => Effect.Effect<void>;
}

export interface AgentScopeCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

export const AgentScope = Context.Reference<AgentScopeShape>("@supaterm/shared/AgentScope", {
  defaultValue: () => ({
    wrap: ({ command, args }) => Effect.succeed({ command, args }),
    oomKilled: () => Effect.succeed(false),
    clear: () => Effect.void,
  }),
});

export const AgentScopeThreadId = Context.Reference<string | undefined>(
  "@supaterm/shared/AgentScope/ThreadId",
  { defaultValue: () => undefined },
);

export const AGENT_OOM_SCORE_ADJ = 800;

export const RAISE_OOM_SCORE_LINE = `{ echo ${AGENT_OOM_SCORE_ADJ} >/proc/self/oom_score_adj; } 2>/dev/null`;

const LAUNCH_SCRIPT = [RAISE_OOM_SCORE_LINE, 'exec "$@"'].join("\n");

// systemd-run needs XDG_RUNTIME_DIR to reach this user's manager.
const SCOPED_LAUNCH_SCRIPT = [
  RAISE_OOM_SCORE_LINE,
  ': "${XDG_RUNTIME_DIR:=$1}"',
  "export XDG_RUNTIME_DIR",
  "shift",
  'exec "$@"',
].join("\n");

export interface AgentSystemdScope {
  readonly systemdRun: string;
  readonly slice: string;
  readonly unit: string;
  readonly runtimeDir: string;
  readonly options: ReadonlyArray<string>;
}

/** Exec at every step preserves the agent PID, stdio, and signals; systemd-run places it and descendants in the scope. */
export function agentScopeCommand(input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly scope?: AgentSystemdScope | undefined;
}): AgentScopeCommand {
  const { command, args, scope } = input;
  if (scope === undefined) {
    return { command: "/bin/sh", args: ["-c", LAUNCH_SCRIPT, "supaterm-agent", command, ...args] };
  }
  return {
    command: "/bin/sh",
    args: [
      "-c",
      SCOPED_LAUNCH_SCRIPT,
      "supaterm-agent",
      scope.runtimeDir,
      scope.systemdRun,
      "--user",
      "--scope",
      "--quiet",
      `--slice=${scope.slice}`,
      `--unit=${scope.unit}`,
      ...scope.options,
      "--",
      command,
      ...args,
    ],
  };
}
