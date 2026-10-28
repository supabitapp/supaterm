import type { OrchestrationV2TurnItem } from "@supaterm/contracts";

export const NEXT_PROMPT_ACTIVITY_TYPES = [
  "command_execution",
  "file_change",
  "dynamic_tool",
  "todo_list",
  "subagent",
  "error",
] as const satisfies ReadonlyArray<OrchestrationV2TurnItem["type"]>;

const MAX_ACTIVITY = 3_000;
const MAX_COMMAND = 160;
const MAX_FAILED_OUTPUT = 600;
const MAX_PASSED_OUTPUT = 160;
const MAX_FILES = 12;

const oneLine = (text: string, max: number) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
};

// The end of a command's output is where test runners and compilers report what failed.
const tail = (text: string, max: number) => {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `…${trimmed.slice(-max)}`;
};

const indent = (text: string) =>
  text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

const describeCommand = (item: Extract<OrchestrationV2TurnItem, { type: "command_execution" }>) => {
  const failed =
    item.status === "failed" ||
    item.outputIndicatesFailure === true ||
    (item.exitCode !== undefined && item.exitCode !== 0);
  const outcome =
    item.exitCode !== undefined ? `exit ${item.exitCode}` : failed ? "failed" : item.status;
  const output = item.output?.trim()
    ? `\n${indent(tail(item.output, failed ? MAX_FAILED_OUTPUT : MAX_PASSED_OUTPUT))}`
    : "";
  return `- ran \`${oneLine(item.input, MAX_COMMAND)}\` (${outcome})${output}`;
};

const describeEdits = (
  edits: ReadonlyArray<Extract<OrchestrationV2TurnItem, { type: "file_change" }>>,
) => {
  const sum = (a: number | undefined, b: number | undefined) =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  const totals = new Map<
    string,
    { additions: number | undefined; deletions: number | undefined }
  >();
  for (const edit of edits) {
    const total = totals.get(edit.fileName);
    totals.set(edit.fileName, {
      additions: sum(total?.additions, edit.additions),
      deletions: sum(total?.deletions, edit.deletions),
    });
  }
  const files = [...totals.entries()];
  const listed = files
    .slice(0, MAX_FILES)
    .map(([fileName, total]) =>
      total.additions === undefined && total.deletions === undefined
        ? fileName
        : `${fileName} (+${total.additions ?? 0} -${total.deletions ?? 0})`,
    );
  const more = files.length > MAX_FILES ? `, and ${files.length - MAX_FILES} more` : "";
  return `- edited ${listed.join(", ")}${more}`;
};

const describeTodos = (item: Extract<OrchestrationV2TurnItem, { type: "todo_list" }>) =>
  [
    "- todo list:",
    ...item.steps.map((step) => `    [${step.status === "completed" ? "x" : " "}] ${step.text}`),
  ].join("\n");

/**
 * What the agent did in one run, newest kept first when it does not all fit: the commands it
 * ran with their results, the files it edited, its latest todo list, and failures. The
 * conversation text alone misses details a user reacts to, such as which test failed.
 */
export function formatNextPromptActivity(items: ReadonlyArray<OrchestrationV2TurnItem>): string {
  const lines: Array<string> = [];
  for (const item of items) {
    switch (item.type) {
      case "command_execution":
        lines.push(describeCommand(item));
        break;
      case "dynamic_tool":
        if (item.toolName !== null) lines.push(`- called ${item.toolName}`);
        break;
      case "subagent":
        lines.push(
          `- delegated "${oneLine(item.prompt, MAX_COMMAND)}"${
            item.result === null ? "" : `: ${oneLine(item.result, MAX_PASSED_OUTPUT)}`
          }`,
        );
        break;
      case "error":
        lines.push(`- error: ${oneLine(item.failure.message, MAX_PASSED_OUTPUT)}`);
        break;
    }
  }
  const edits = items.filter((item) => item.type === "file_change");
  if (edits.length > 0) lines.push(describeEdits(edits));
  const todos = items.findLast((item) => item.type === "todo_list");
  if (todos !== undefined && todos.steps.length > 0) lines.push(describeTodos(todos));

  const kept: Array<string> = [];
  let remaining = MAX_ACTIVITY;
  for (const line of lines.toReversed()) {
    if (line.length + 1 > remaining) break;
    kept.unshift(line);
    remaining -= line.length + 1;
  }
  return kept.join("\n");
}
