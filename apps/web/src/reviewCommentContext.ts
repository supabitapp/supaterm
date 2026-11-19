import type { FileDiffMetadata, SelectedLineRange, SelectionSide } from "@pierre/diffs";
import { PullRequestContextMetadata, type PullRequestReviewPosition } from "@supaterm/contracts";
import * as Schema from "effect/Schema";

import { isLineInFileDiff } from "./components/pullRequest/pullRequestDiff.logic";

const ReviewCommentSelectionSchema = Schema.Struct({
  start: Schema.Number,
  side: Schema.Literals(["additions", "deletions"]),
  end: Schema.Number,
  endSide: Schema.Literals(["additions", "deletions"]),
});
type ReviewCommentSelection = typeof ReviewCommentSelectionSchema.Type;

export const ReviewCommentContextSchema = Schema.Struct({
  id: Schema.String,
  sectionId: Schema.String,
  sectionTitle: Schema.String,
  filePath: Schema.String,
  startIndex: Schema.Number,
  endIndex: Schema.Number,
  rangeLabel: Schema.String,
  text: Schema.String,
  diff: Schema.String,
  fenceLanguage: Schema.optional(Schema.String),
  selection: Schema.optional(ReviewCommentSelectionSchema),
  pullRequest: Schema.optional(PullRequestContextMetadata),
});

export interface ReviewCommentContext {
  readonly id: string;
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly filePath: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly rangeLabel: string;
  readonly text: string;
  readonly diff: string;
  readonly fenceLanguage?: string | undefined;
  readonly selection?: ReviewCommentSelection | undefined;
  readonly pullRequest?: PullRequestContextMetadata | undefined;
}

interface DiffReviewLine {
  readonly change: "context" | "add" | "delete";
  readonly oldLineNumber: number | null;
  readonly newLineNumber: number | null;
  readonly content: string;
}

export function formatReviewCommentFence(language: string, contents: string) {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(contents.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return [`${fence}${language}`, contents.trimEnd(), fence].join("\n");
}

export function buildFileReviewComment(input: {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  contents: string;
}) {
  const startLine = Math.max(1, Math.min(input.startLine, input.endLine));
  const endLine = Math.max(startLine, Math.max(input.startLine, input.endLine));
  const selectedLines = input.contents.split("\n").slice(startLine - 1, endLine);
  return {
    id: input.id,
    sectionId: `file:${input.filePath}`,
    sectionTitle: "File comment",
    filePath: input.filePath,
    startIndex: startLine - 1,
    endIndex: endLine - 1,
    rangeLabel: startLine === endLine ? `L${startLine}` : `L${startLine} to L${endLine}`,
    text: input.text.trim(),
    diff: selectedLines.join("\n"),
    fenceLanguage: inferReviewCommentFenceLanguage(input.filePath),
  };
}

export function inferReviewCommentFenceLanguage(filePath: string) {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const fileName = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1).toLowerCase();
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex > 0 && extensionIndex < fileName.length - 1) {
    return fileName.slice(extensionIndex + 1);
  }
  if (fileName.startsWith(".") && fileName.length > 1) {
    return fileName.slice(1);
  }
  return "text";
}

function stripTrailingNewline(value: string) {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function buildDiffReviewLines(
  fileDiff: FileDiffMetadata,
  includeExpandedContext: boolean,
  slice?: { readonly startIndex: number; readonly endIndex: number },
) {
  const rows: DiffReviewLine[] = [];
  let rowIndex = 0;
  let oldContextStart = 1;
  let newContextStart = 1;
  const pushRow = (row: DiffReviewLine) => {
    if (!slice || (rowIndex >= slice.startIndex && rowIndex <= slice.endIndex)) {
      rows.push(row);
    }
    rowIndex += 1;
  };
  const pushContextGap = (oldStart: number, newStart: number, lineCount: number) => {
    const count = Math.max(0, lineCount);
    const firstOffset = slice ? Math.max(0, slice.startIndex - rowIndex) : 0;
    const lastOffset = slice ? Math.min(count - 1, slice.endIndex - rowIndex) : count - 1;
    for (let offset = firstOffset; offset <= lastOffset; offset += 1) {
      rows.push({
        change: "context",
        oldLineNumber: oldStart + offset,
        newLineNumber: newStart + offset,
        content: stripTrailingNewline(fileDiff.additionLines[newStart + offset - 1] ?? ""),
      });
    }
    rowIndex += count;
  };

  for (const hunk of fileDiff.hunks) {
    if (includeExpandedContext) {
      const oldHunkStart = hunk.deletionStart + (hunk.deletionCount === 0 ? 1 : 0);
      const newHunkStart = hunk.additionStart + (hunk.additionCount === 0 ? 1 : 0);
      const contextLines = Math.min(oldHunkStart - oldContextStart, newHunkStart - newContextStart);
      pushContextGap(oldContextStart, newContextStart, contextLines);
    }

    let oldLineNumber = hunk.deletionStart;
    let newLineNumber = hunk.additionStart;
    let deletionLineIndex = hunk.deletionLineIndex;
    let additionLineIndex = hunk.additionLineIndex;

    for (const segment of hunk.hunkContent) {
      if (segment.type === "context") {
        for (let index = 0; index < segment.lines; index += 1) {
          pushRow({
            change: "context",
            oldLineNumber,
            newLineNumber,
            content: stripTrailingNewline(
              fileDiff.additionLines[additionLineIndex] ??
                fileDiff.deletionLines[deletionLineIndex] ??
                "",
            ),
          });
          oldLineNumber += 1;
          newLineNumber += 1;
          deletionLineIndex += 1;
          additionLineIndex += 1;
        }
        continue;
      }

      for (let index = 0; index < segment.deletions; index += 1) {
        pushRow({
          change: "delete",
          oldLineNumber,
          newLineNumber: null,
          content: stripTrailingNewline(fileDiff.deletionLines[deletionLineIndex] ?? ""),
        });
        oldLineNumber += 1;
        deletionLineIndex += 1;
      }

      for (let index = 0; index < segment.additions; index += 1) {
        pushRow({
          change: "add",
          oldLineNumber: null,
          newLineNumber,
          content: stripTrailingNewline(fileDiff.additionLines[additionLineIndex] ?? ""),
        });
        newLineNumber += 1;
        additionLineIndex += 1;
      }
    }

    oldContextStart = hunk.deletionStart + hunk.deletionCount;
    newContextStart = hunk.additionStart + hunk.additionCount;
    if (hunk.deletionCount === 0) oldContextStart += 1;
    if (hunk.additionCount === 0) newContextStart += 1;
  }

  if (includeExpandedContext) {
    const trailingLines = Math.min(
      fileDiff.deletionLines.length - oldContextStart + 1,
      fileDiff.additionLines.length - newContextStart + 1,
    );
    pushContextGap(oldContextStart, newContextStart, trailingLines);
  }

  return rows;
}

function getDiffReviewSelectionPoint(line: DiffReviewLine) {
  if (line.change === "delete" && line.oldLineNumber !== null) {
    return { lineNumber: line.oldLineNumber, side: "deletions" } satisfies {
      lineNumber: number;
      side: SelectionSide;
    } | null;
  }
  if (line.newLineNumber !== null) {
    return { lineNumber: line.newLineNumber, side: "additions" } satisfies {
      lineNumber: number;
      side: SelectionSide;
    } | null;
  }
  if (line.oldLineNumber !== null) {
    return { lineNumber: line.oldLineNumber, side: "deletions" } satisfies {
      lineNumber: number;
      side: SelectionSide;
    } | null;
  }
  return null satisfies { lineNumber: number; side: SelectionSide } | null;
}

export function restoreDiffReviewCommentRange(
  fileDiff: FileDiffMetadata,
  comment: ReviewCommentContext,
) {
  if (comment.selection) return comment.selection satisfies SelectedLineRange | null;

  const includeExpandedContext = !fileDiff.isPartial;
  const startLine = buildDiffReviewLines(fileDiff, includeExpandedContext, {
    startIndex: comment.startIndex,
    endIndex: comment.startIndex,
  })[0];
  const endLine =
    comment.endIndex === comment.startIndex
      ? startLine
      : buildDiffReviewLines(fileDiff, includeExpandedContext, {
          startIndex: comment.endIndex,
          endIndex: comment.endIndex,
        })[0];
  if (!startLine || !endLine) return null satisfies SelectedLineRange | null;
  const start = getDiffReviewSelectionPoint(startLine);
  const end = getDiffReviewSelectionPoint(endLine);
  if (!start || !end) return null satisfies SelectedLineRange | null;
  return {
    start: start.lineNumber,
    side: start.side,
    end: end.lineNumber,
    endSide: end.side,
  } satisfies SelectedLineRange | null;
}

function findDiffReviewLineIndex(
  fileDiff: FileDiffMetadata,
  lineNumber: number,
  side: SelectionSide | undefined,
  includeExpandedContext = !fileDiff.isPartial,
) {
  const findOnSide = (selectedSide: "left" | "right") => {
    let rowIndex = 0;
    let oldContextStart = 1;
    let newContextStart = 1;
    const findContextIndex = (oldStart: number, newStart: number, lineCount: number) => {
      const count = Math.max(0, lineCount);
      const selectedStart = selectedSide === "left" ? oldStart : newStart;
      const offset = lineNumber - selectedStart;
      return offset >= 0 && offset < count ? rowIndex + offset : -1;
    };

    for (const hunk of fileDiff.hunks) {
      if (includeExpandedContext) {
        const oldContextEnd = hunk.deletionStart + (hunk.deletionCount === 0 ? 1 : 0);
        const newContextEnd = hunk.additionStart + (hunk.additionCount === 0 ? 1 : 0);
        const contextLines = Math.min(
          oldContextEnd - oldContextStart,
          newContextEnd - newContextStart,
        );
        const contextIndex = findContextIndex(oldContextStart, newContextStart, contextLines);
        if (contextIndex >= 0) return contextIndex;
        rowIndex += Math.max(0, contextLines);
      }

      let oldLineNumber = hunk.deletionStart;
      let newLineNumber = hunk.additionStart;
      for (const segment of hunk.hunkContent) {
        if (segment.type === "context") {
          const contextIndex = findContextIndex(oldLineNumber, newLineNumber, segment.lines);
          if (contextIndex >= 0) return contextIndex;
          rowIndex += segment.lines;
          oldLineNumber += segment.lines;
          newLineNumber += segment.lines;
          continue;
        }

        if (
          selectedSide === "left" &&
          lineNumber >= oldLineNumber &&
          lineNumber < oldLineNumber + segment.deletions
        ) {
          return rowIndex + lineNumber - oldLineNumber;
        }
        rowIndex += segment.deletions;
        oldLineNumber += segment.deletions;

        if (
          selectedSide === "right" &&
          lineNumber >= newLineNumber &&
          lineNumber < newLineNumber + segment.additions
        ) {
          return rowIndex + lineNumber - newLineNumber;
        }
        rowIndex += segment.additions;
        newLineNumber += segment.additions;
      }

      oldContextStart = hunk.deletionStart + hunk.deletionCount;
      newContextStart = hunk.additionStart + hunk.additionCount;
      if (hunk.deletionCount === 0) oldContextStart += 1;
      if (hunk.additionCount === 0) newContextStart += 1;
    }

    if (!includeExpandedContext) return -1;
    const trailingLines = Math.min(
      fileDiff.deletionLines.length - oldContextStart + 1,
      fileDiff.additionLines.length - newContextStart + 1,
    );
    return findContextIndex(oldContextStart, newContextStart, trailingLines);
  };

  const selectedSide = side === "deletions" ? "left" : "right";
  const preferredIndex = findOnSide(selectedSide);
  return preferredIndex >= 0
    ? preferredIndex
    : findOnSide(selectedSide === "left" ? "right" : "left");
}

export function resolveDiffReviewPosition(
  fileDiff: FileDiffMetadata,
  lineNumber: number,
  side: SelectionSide | undefined,
) {
  const lineIndex = findDiffReviewLineIndex(fileDiff, lineNumber, side);
  if (lineIndex < 0) return null satisfies PullRequestReviewPosition | null;
  const line = buildDiffReviewLines(fileDiff, !fileDiff.isPartial, {
    startIndex: lineIndex,
    endIndex: lineIndex,
  })[0];
  if (line === undefined) return null satisfies PullRequestReviewPosition | null;

  if (
    (side === "additions" && line.newLineNumber !== lineNumber) ||
    (side === "deletions" && line.oldLineNumber !== lineNumber)
  ) {
    return null satisfies PullRequestReviewPosition | null;
  }

  switch (line.change) {
    case "add":
      return (
        line.newLineNumber === null ? null : { kind: "added", newLine: line.newLineNumber }
      ) satisfies PullRequestReviewPosition | null;
    case "delete":
      return (
        line.oldLineNumber === null ? null : { kind: "deleted", oldLine: line.oldLineNumber }
      ) satisfies PullRequestReviewPosition | null;
    case "context":
      return (
        line.oldLineNumber === null ||
        line.newLineNumber === null ||
        !isLineInFileDiff(fileDiff, "right", line.newLineNumber)
          ? null
          : {
              kind: "context",
              oldLine: line.oldLineNumber,
              newLine: line.newLineNumber,
              side: side === "deletions" ? "left" : "right",
            }
      ) satisfies PullRequestReviewPosition | null;
  }
}

function reviewHunkIndex(fileDiff: FileDiffMetadata, position: PullRequestReviewPosition) {
  const [side, line] =
    position.kind === "deleted"
      ? (["left", position.oldLine] as const)
      : (["right", position.newLine] as const);
  return fileDiff.hunks.findIndex((hunk) =>
    side === "left"
      ? line >= hunk.deletionStart && line < hunk.deletionStart + hunk.deletionCount
      : line >= hunk.additionStart && line < hunk.additionStart + hunk.additionCount,
  );
}

/**
 * Where a review comment on `range` is anchored. With `ranged`, a selection inside one hunk
 * keeps its first line, in diff order, as `startPosition`, because hosts refuse a range that
 * crosses hunks. Otherwise the comment sits on the line the selection ended on.
 */
export function resolveDiffReviewAnchor(
  fileDiff: FileDiffMetadata,
  range: SelectedLineRange,
  ranged: boolean,
) {
  const endSide = range.endSide ?? range.side;
  const last = resolveDiffReviewPosition(fileDiff, range.end, endSide);
  if (last === null)
    return null satisfies {
      readonly position: PullRequestReviewPosition;
      readonly startPosition?: PullRequestReviewPosition;
    } | null;
  const first = ranged ? resolveDiffReviewPosition(fileDiff, range.start, range.side) : null;
  if (first === null)
    return { position: last } satisfies {
      readonly position: PullRequestReviewPosition;
      readonly startPosition?: PullRequestReviewPosition;
    } | null;
  const startIndex = findDiffReviewLineIndex(fileDiff, range.start, range.side);
  const endIndex = findDiffReviewLineIndex(fileDiff, range.end, endSide);
  if (startIndex === endIndex)
    return { position: last } satisfies {
      readonly position: PullRequestReviewPosition;
      readonly startPosition?: PullRequestReviewPosition;
    } | null;
  const [start, end] = startIndex < endIndex ? [first, last] : [last, first];
  const hunk = reviewHunkIndex(fileDiff, end);
  return (
    hunk >= 0 && reviewHunkIndex(fileDiff, start) === hunk
      ? { position: end, startPosition: start }
      : { position: last }
  ) satisfies {
    readonly position: PullRequestReviewPosition;
    readonly startPosition?: PullRequestReviewPosition;
  } | null;
}

function getDiffRange(
  lines: ReadonlyArray<DiffReviewLine>,
  key: "oldLineNumber" | "newLineNumber",
) {
  const numberedLines = lines.filter((line) => line[key] !== null);
  return {
    start: numberedLines[0]?.[key] ?? 0,
    count: numberedLines.length,
  };
}

function getDiffChangeMarker(change: DiffReviewLine["change"]) {
  if (change === "add") return "+";
  if (change === "delete") return "-";
  return " ";
}

function formatDiffReviewRangeLabel(lines: ReadonlyArray<DiffReviewLine>) {
  const firstLine = lines[0];
  const lastLine = lines.at(-1);
  if (!firstLine || !lastLine) return "line";
  const firstNumber = firstLine.newLineNumber ?? firstLine.oldLineNumber;
  const lastNumber = lastLine.newLineNumber ?? lastLine.oldLineNumber;
  if (firstNumber === null || lastNumber === null) {
    return lines.length === 1 ? "line" : `${lines.length} lines`;
  }

  const firstMarker = getDiffChangeMarker(firstLine.change).trim();
  const marker =
    firstMarker.length > 0 && lines.every((line) => line.change === firstLine.change)
      ? firstMarker
      : "";
  return firstNumber === lastNumber
    ? `${marker}${firstNumber}`
    : `${marker}${firstNumber} to ${marker}${lastNumber}`;
}

export function diffReviewSelectionId(fileKey: string, range: SelectedLineRange) {
  return `${fileKey}:${range.side ?? "additions"}:${range.start}:${range.endSide ?? range.side ?? "additions"}:${range.end}`;
}

export function buildDiffReviewComment(input: {
  id: string;
  sectionId: string;
  sectionTitle: string;
  filePath: string;
  fileDiff: FileDiffMetadata;
  range: SelectedLineRange;
  text: string;
}) {
  const includeExpandedContext = !input.fileDiff.isPartial;
  const startIndex = findDiffReviewLineIndex(
    input.fileDiff,
    input.range.start,
    input.range.side,
    includeExpandedContext,
  );
  const endIndex = findDiffReviewLineIndex(
    input.fileDiff,
    input.range.end,
    input.range.endSide ?? input.range.side,
    includeExpandedContext,
  );
  if (startIndex < 0 || endIndex < 0) return null;

  const normalizedStartIndex = Math.min(startIndex, endIndex);
  const normalizedEndIndex = Math.max(startIndex, endIndex);
  const selectedLines = buildDiffReviewLines(input.fileDiff, includeExpandedContext, {
    startIndex: normalizedStartIndex,
    endIndex: normalizedEndIndex,
  });
  const oldRange = getDiffRange(selectedLines, "oldLineNumber");
  const newRange = getDiffRange(selectedLines, "newLineNumber");

  return {
    id: input.id,
    sectionId: input.sectionId,
    sectionTitle: input.sectionTitle,
    filePath: input.filePath,
    startIndex: normalizedStartIndex,
    endIndex: normalizedEndIndex,
    rangeLabel: formatDiffReviewRangeLabel(selectedLines),
    text: input.text.trim(),
    diff: [
      `@@ -${oldRange.start},${oldRange.count} +${newRange.start},${newRange.count} @@`,
      ...selectedLines.map((line) => `${getDiffChangeMarker(line.change)}${line.content}`),
    ].join("\n"),
    fenceLanguage: "diff",
    selection: {
      start: input.range.start,
      side: input.range.side ?? "additions",
      end: input.range.end,
      endSide: input.range.endSide ?? input.range.side ?? "additions",
    },
  };
}

export function buildReviewCommentRenderablePatch(comment: ReviewCommentContext) {
  if ((comment.fenceLanguage ?? "diff") !== "diff") {
    return "";
  }
  if (comment.diff.trim().length === 0) {
    return "";
  }
  const diff = comment.diff.trimStart().replace(/\n+$/, "");
  if (diff.startsWith("diff --git ")) {
    return diff;
  }

  const normalizedPath = comment.filePath.replaceAll("\\", "/");
  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    `--- a/${normalizedPath}`,
    `+++ b/${normalizedPath}`,
    diff,
  ].join("\n");
}
