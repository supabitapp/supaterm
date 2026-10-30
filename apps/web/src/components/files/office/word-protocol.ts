import type { Method } from "./worker-rpc";

export type WordLink =
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "internal"; readonly bookmark: string };

export type WordSpan = {
  readonly text: string;

  readonly left: number;
  readonly top: number;

  readonly size: number;

  readonly transform: string;
  readonly dir: "ltr" | "rtl";
  readonly link: WordLink | undefined;
  readonly title: string | undefined;

  readonly after: "br" | "tab" | undefined;
};

export type WordPageSize = {
  readonly width: number;
  readonly height: number;
  readonly background: string | undefined;
};

export const lineHeight = 1.2;

export const layerFont = "sans-serif";

export type WordLayoutStep =
  | { readonly done: false }
  | {
      readonly done: true;
      readonly pages: readonly WordPageSize[];
      readonly kept: readonly boolean[];
    };

export type WordMethods = {
  readonly open: Method<
    { readonly bytes: ArrayBuffer },
    { readonly pages: readonly WordPageSize[]; readonly loading: boolean }
  >;

  readonly layout: Method<undefined, WordLayoutStep>;

  readonly paint: Method<
    { readonly index: number; readonly scale: number; readonly ratio: number },
    ImageBitmap | undefined
  >;

  readonly build: Method<{ readonly index: number }, undefined>;

  readonly text: Method<{ readonly index: number }, readonly WordSpan[]>;

  readonly bookmark: Method<
    { readonly name: string },
    { readonly index: number; readonly y: number } | undefined
  >;
};
