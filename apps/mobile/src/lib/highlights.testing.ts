import { createHighlighter } from "@pierre/highlights";

interface LineRecordHighlighter {
  writeInput(input: string): number;
  tokenizeLineRecords(language: number, byteLength: number): Uint32Array;
}

/**
 * Stands in for the SupatermHighlights hybrid object with the WebAssembly build it is
 * compiled from. Return it from a mocked `NitroModules.createHybridObject`.
 */
export function createWasmHighlightsModule() {
  const highlighter = createHighlighter() as unknown as LineRecordHighlighter;
  return {
    tokenize(source: string, language: number) {
      const records = highlighter.tokenizeLineRecords(language, highlighter.writeInput(source));
      return records.slice().buffer;
    },
  };
}
