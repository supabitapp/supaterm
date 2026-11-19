import type { NativeReviewDiffRow } from "../diffs/nativeReviewDiffSurface";
import type { ResolvedMobileCodeSurface } from "../../lib/appearancePreferences";
import { MOBILE_CODE_SURFACE, MOBILE_TYPOGRAPHY } from "../../lib/typography";
import type { HighlightedLines } from "../../lib/highlights";

export const NATIVE_SOURCE_CONTENT_WIDTH = 32_000;

export function createNativeSourceStyle(codeSurface: ResolvedMobileCodeSurface) {
  return {
    rowHeight: codeSurface.rowHeight,
    contentWidth: NATIVE_SOURCE_CONTENT_WIDTH,
    changeBarWidth: 0,
    gutterWidth: codeSurface.gutterWidth,
    codePadding: codeSurface.codePadding,
    textVerticalInset: codeSurface.textVerticalInset,
    codeFontSize: codeSurface.fontSize,
    codeFontWeight: "regular",
    lineNumberFontSize: codeSurface.lineNumberFontSize,
    lineNumberFontWeight: "regular",
    emptyStateFontSize: Math.round(
      MOBILE_TYPOGRAPHY.label.fontSize * (codeSurface.fontSize / MOBILE_CODE_SURFACE.fontSize),
    ),
    emptyStateFontWeight: "medium",
  };
}

const SOURCE_FILE_ID = "source-file";

function expandTabs(value: string) {
  return value.replace(/\t/g, "    ");
}

export function nativeSourceRowId(index: number) {
  return `source-line:${index}`;
}

export function buildNativeSourceRows(lines: ReadonlyArray<string>) {
  return lines.map((line, index) => ({
    kind: "line",
    id: nativeSourceRowId(index),
    fileId: SOURCE_FILE_ID,
    content: expandTabs(line),
    change: "context",
    newLineNumber: index + 1,
  })) satisfies ReadonlyArray<NativeReviewDiffRow>;
}

export function buildNativeSourceTokens(tokenLines: HighlightedLines | null) {
  if (tokenLines === null) {
    return {};
  }

  return Object.fromEntries(
    tokenLines.map((tokens, index) => [
      nativeSourceRowId(index),
      tokens.map((token) => ({
        content: expandTabs(token.content),
        color: token.color,
        fontStyle: token.fontStyle,
      })),
    ]),
  );
}
