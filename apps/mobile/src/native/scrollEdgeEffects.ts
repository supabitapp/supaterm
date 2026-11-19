export type NativeTopScrollEdgeEffect = "automatic" | "soft";
export type NativeHeaderScrollEdgeEffects = {
  readonly top: NativeTopScrollEdgeEffect;
  readonly bottom: "hidden";
  readonly left: "hidden";
  readonly right: "hidden";
};

function nativeTopScrollEdgeEffect(
  os: string,
  _version: number | string,
): NativeTopScrollEdgeEffect;
function nativeTopScrollEdgeEffect(os: string, _version: number | string) {
  if (os !== "ios") {
    return "automatic" satisfies NativeTopScrollEdgeEffect;
  }

  return "automatic" satisfies NativeTopScrollEdgeEffect;
}

export function nativeHeaderScrollEdgeEffects(
  os: string,
  version: number | string,
): NativeHeaderScrollEdgeEffects;
export function nativeHeaderScrollEdgeEffects(os: string, version: number | string) {
  return {
    top: nativeTopScrollEdgeEffect(os, version),
    bottom: "hidden",
    left: "hidden",
    right: "hidden",
  } satisfies NativeHeaderScrollEdgeEffects;
}
