import type { DiagramOptions, MathMarkup } from "@supaterm/mermaid/diagram";

export interface MathLabel {
  readonly tex: string;
  readonly size: number;
}

export interface DiagramWorkerRequest {
  readonly source: string;
  readonly options: DiagramOptions;
  readonly math?: ReadonlyArray<readonly [string, MathMarkup | null]>;
}

export const mathLabelKey = (label: MathLabel) => `${label.size}:${label.tex}`;
