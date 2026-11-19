import type { OrchestrationV2TurnItem } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

type CommandExecutionItem = Extract<OrchestrationV2TurnItem, { type: "command_execution" }>;

const CLAUDE_RAW_BASH_RESULT_CUTOFF = DateTime.makeUnsafe("2026-10-09T00:00:00Z");

const decodeClaudeBashResult = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ stdout: Schema.String, stderr: Schema.String, interrupted: Schema.Boolean }),
  ),
);

function storesRawClaudeBashResult(item: CommandExecutionItem) {
  return (
    item.nativeItemRef?.driver === "claudeAgent" &&
    DateTime.isLessThan(item.startedAt ?? item.updatedAt, CLAUDE_RAW_BASH_RESULT_CUTOFF)
  );
}

/** The output a command row shows: the stored bytes, except early Claude rows' raw Bash envelopes. */
export function commandItemOutput(item: CommandExecutionItem): string | undefined;
export function commandItemOutput(item: CommandExecutionItem) {
  const output = item.output;
  if (output === undefined || !storesRawClaudeBashResult(item))
    return output satisfies string | undefined;
  if (!output.trimStart().startsWith('{"stdout"')) return output satisfies string | undefined;
  const parsed = decodeClaudeBashResult(output);
  if (Option.isNone(parsed)) return output satisfies string | undefined;
  const out = parsed.value.stdout.trim().length > 0 ? parsed.value.stdout : "";
  const err = parsed.value.stderr.trim().length > 0 ? parsed.value.stderr : "";
  return (
    out.length > 0 && err.length > 0 && !out.endsWith("\n") ? `${out}\n${err}` : out + err
  ) satisfies string | undefined;
}
