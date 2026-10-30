import type { Method } from "./worker-rpc";

export const maxImageSide = 2560;

export type SlideSummary = {
  readonly width: number;
  readonly height: number;
  readonly hidden: boolean;
  readonly notes: string | undefined;
};

export type VectorRequest = {
  readonly asset: string;
  readonly blob: Blob;
  readonly size: { readonly width: number; readonly height: number } | undefined;
};

export type VectorBitmap = { readonly asset: string; readonly bitmap: ImageBitmap | undefined };

export type SlidePainted =
  | {
      readonly kind: "painted";

      readonly bitmap: ImageBitmap;

      readonly vectors: readonly VectorRequest[];
    }
  | { readonly kind: "failed" }
  | { readonly kind: "cancelled" };

export type SlideMethods = {
  readonly open: Method<{ readonly bytes: ArrayBuffer }, readonly SlideSummary[]>;

  readonly paint: Method<{ readonly index: number; readonly density: number }, SlidePainted>;

  readonly vectors: Method<readonly VectorBitmap[], void>;
};
