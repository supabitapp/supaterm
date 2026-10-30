import { createHighlighter } from "@pierre/highlights";

interface LineRecordHighlighter {
  writeInput(input: string): number;
  tokenizeLineRecords(language: number, byteLength: number): Uint32Array;
}

export function createWasmHighlightsModule() {
  const highlighter = createHighlighter() as unknown as LineRecordHighlighter;
  return {
    tokenize(source: string, language: number): ArrayBuffer {
      const records = highlighter.tokenizeLineRecords(language, highlighter.writeInput(source));

      return records.slice().buffer;
    },
  };
}
