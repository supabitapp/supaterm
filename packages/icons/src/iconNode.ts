export interface IconNode {
  readonly stroke?: string;
  /** Path operations produce this, so it is filled with the even-odd rule. */
  readonly fill?: string;
}

export const ICON_STROKE_WIDTH = 1.5;
