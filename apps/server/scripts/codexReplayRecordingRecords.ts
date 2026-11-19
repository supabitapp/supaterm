const REPLAY_WORKSPACE_PLACEHOLDER = "<workspace>";
const REPLAY_HOME = "/home/replay-user";
const REPLAY_CHECKOUT = "/home/replay-user/supaterm";
const REPLAY_HOSTNAME = "replay-host";
const REPLAY_VALUES_BY_KEY: Readonly<Record<string, string>> = {
  installationId: "00000000-0000-4000-8000-000000000000",
  planType: "unknown",
};

interface CodexReplayRecordingMachine {
  readonly home: string;
  readonly hostname: string;
  readonly checkout: string;
}

function withWorkspacePlaceholder(value: unknown, workspace: string): unknown;
function withWorkspacePlaceholder(value: unknown, workspace: string) {
  if (value === workspace) {
    return REPLAY_WORKSPACE_PLACEHOLDER satisfies unknown;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => withWorkspacePlaceholder(entry, workspace)) satisfies unknown;
  }
  if (typeof value !== "object" || value === null) {
    return value satisfies unknown;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, withWorkspacePlaceholder(entry, workspace)]),
  ) satisfies unknown;
}

function withoutMachineIdentity(
  value: unknown,
  machine: CodexReplayRecordingMachine,
  key?: string,
): unknown;
function withoutMachineIdentity(
  value: unknown,
  machine: CodexReplayRecordingMachine,
  key?: string,
) {
  if (typeof value === "string") {
    const replacement = key === undefined ? undefined : REPLAY_VALUES_BY_KEY[key];
    if (replacement !== undefined) return replacement satisfies unknown;
    return (
      value === machine.hostname
        ? REPLAY_HOSTNAME
        : value.replaceAll(machine.checkout, REPLAY_CHECKOUT).replaceAll(machine.home, REPLAY_HOME)
    ) satisfies unknown;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => withoutMachineIdentity(entry, machine)) satisfies unknown;
  }
  if (typeof value !== "object" || value === null) {
    return value satisfies unknown;
  }
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entry]) => [
      entryKey,
      withoutMachineIdentity(entry, machine, entryKey),
    ]),
  ) satisfies unknown;
}

export function codexReplayRecordingOutputRecords(
  records: ReadonlyArray<Record<string, unknown>>,
  options: {
    readonly workspace: string;
    readonly machine?: CodexReplayRecordingMachine;
  },
): ReadonlyArray<Record<string, unknown>>;
export function codexReplayRecordingOutputRecords(
  records: ReadonlyArray<Record<string, unknown>>,
  options: {
    readonly workspace: string;
    readonly machine?: CodexReplayRecordingMachine;
  },
) {
  return records.map((record) => {
    const named =
      record.type === "expect_outbound"
        ? { ...record, frame: withWorkspacePlaceholder(record.frame, options.workspace) }
        : record;
    return options.machine === undefined || !("frame" in named)
      ? named
      : { ...named, frame: withoutMachineIdentity(named.frame, options.machine) };
  }) satisfies ReadonlyArray<Record<string, unknown>>;
}
