import { settlePromise, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import {
  highlightNativeReviewDiffVisibleRows,
  type NativeReviewDiffHighlightEngine,
  type NativeReviewDiffHighlightScheme,
} from "../diffs/nativeReviewDiffHighlighter";
import type { NativeReviewDiffRow } from "../diffs/nativeReviewDiffSurface";
import type { NativeReviewDiffFile } from "../diffs/nativeReviewDiffTypes";

import {
  createReviewDiffHighlightScheduler,
  type NativeReviewVisibleRange,
} from "./reviewDiffHighlightScheduler";

function createEmptyTokenPatch(resetKey: string): string {
  return JSON.stringify({ resetKey, tokensByRowId: {} });
}

function isReviewDiffDebugLoggingEnabled(): boolean {
  return typeof __DEV__ !== "undefined" ? __DEV__ : false;
}

function logReviewDiffDiagnostic(message: string, details?: Record<string, unknown>): void {
  if (!isReviewDiffDebugLoggingEnabled()) {
    return;
  }

  if (details) {
    console.log(`[review-sheet] ${message}`, details);
    return;
  }

  console.log(`[review-sheet] ${message}`);
}

export function useNativeReviewDiffHighlighting(input: {
  readonly files: ReadonlyArray<NativeReviewDiffFile>;
  readonly rows: ReadonlyArray<NativeReviewDiffRow>;
  readonly scheme: NativeReviewDiffHighlightScheme;
  readonly resetKey: string;
  readonly enabled: boolean;
}) {
  const { enabled, files, resetKey, rows, scheme } = input;
  const highlightedRowIdsRef = useRef<Set<string>>(new Set());
  const [visibleRange, setVisibleRange] = useState<NativeReviewVisibleRange>({
    firstRowIndex: 0,
    lastRowIndex: 80,
  });
  const visibleChunkIndexRef = useRef(0);
  const [tokensPatchJson, setTokensPatchJson] = useState(() => createEmptyTokenPatch(resetKey));
  const [highlightSession, setHighlightSession] = useState(() => ({
    enabled,
    resetKey,
    rowCount: rows.length,
    scheduler: createReviewDiffHighlightScheduler(setVisibleRange),
  }));
  if (
    highlightSession.enabled !== enabled ||
    highlightSession.resetKey !== resetKey ||
    highlightSession.rowCount !== rows.length
  ) {
    setHighlightSession({
      enabled,
      resetKey,
      rowCount: rows.length,
      scheduler: createReviewDiffHighlightScheduler(setVisibleRange),
    });
    setVisibleRange({ firstRowIndex: 0, lastRowIndex: 80 });
    setTokensPatchJson(createEmptyTokenPatch(resetKey));
  }
  const { scheduler } = highlightSession;

  useEffect(() => {
    highlightedRowIdsRef.current = new Set();
    visibleChunkIndexRef.current = 0;
    return () => scheduler.cancel();
  }, [scheduler]);

  useEffect(() => {
    if (!enabled || rows.length === 0) {
      return;
    }

    const abortController = new AbortController();
    const requestRange = visibleRange;
    const engine: NativeReviewDiffHighlightEngine = "native";

    void (async () => {
      const settled = await settlePromise(() =>
        highlightNativeReviewDiffVisibleRows({
          files,
          rows,
          scheme,
          engine,
          firstRowIndex: requestRange.firstRowIndex,
          lastRowIndex: requestRange.lastRowIndex,
          alreadyHighlightedRowIds: highlightedRowIdsRef.current,
          signal: abortController.signal,
        }),
      );
      if (abortController.signal.aborted) return;
      if (AsyncResult.isFailure(settled)) {
        logReviewDiffDiagnostic("native visible highlight failed", {
          error: squashAtomCommandFailure(settled),
          resetKey,
          scheme,
          firstRowIndex: requestRange.firstRowIndex,
          lastRowIndex: requestRange.lastRowIndex,
        });
        return;
      }
      const result = settled.value;

      if (result.rowCount === 0) return;

      for (const rowId of Object.keys(result.tokensByRowId)) {
        highlightedRowIdsRef.current.add(rowId);
      }

      const chunkIndex = visibleChunkIndexRef.current;
      visibleChunkIndexRef.current += 1;
      setTokensPatchJson(
        JSON.stringify({
          resetKey,
          chunkIndex,
          fileId: "visible",
          filePath: "visible rows",
          language: "diff",
          lineCount: result.rowCount,
          durationMs: result.durationMs,
          tokensByRowId: result.tokensByRowId,
        }),
      );
    })();

    return () => abortController.abort();
  }, [enabled, files, resetKey, rows, scheme, visibleRange]);

  return {
    tokensPatchJson,
    updateVisibleRange: scheduler.update,
  };
}
