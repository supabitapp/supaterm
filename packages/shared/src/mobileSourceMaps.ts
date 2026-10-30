export type MobilePlatform = "ios" | "android";

export type MobileSourceMapKind = "ota" | "build";

export const mobileSourceMapKey = (
  platform: MobilePlatform,
  kind: MobileSourceMapKind,
  id: string,
) => `${platform}/${kind}/${id}.map`;
