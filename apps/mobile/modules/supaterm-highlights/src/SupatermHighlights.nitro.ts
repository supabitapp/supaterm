import type { CustomType, HybridObject } from "react-native-nitro-modules";

type SourceText = CustomType<string, "SourceText", { include: "SourceText.hpp" }>;

export interface SupatermHighlights extends HybridObject<{ ios: "c++"; android: "c++" }> {
  /**
   * Lexes `source` with @pierre/highlights language `language`. Returns
   * `(endUtf16, tokenId)` uint32 pairs, where token ID 0xffffffff ends a line,
   * or undefined when the lexer could not run.
   */
  tokenize(source: SourceText, language: number): ArrayBuffer | undefined;
}
