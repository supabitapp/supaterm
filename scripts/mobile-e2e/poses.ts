interface PoseOptions {
  readonly id: string;
  readonly device: string;
  readonly form: "phone" | "tablet";
  readonly appearance: "light" | "dark";
  readonly landscape?: boolean;
  readonly fold?: "closed" | "open";
  readonly textSize?: "accessibility-large";
  readonly pending?: string;
}

export type Pose = PoseOptions &
  (
    | { readonly platform: "ios"; readonly iosDeviceType: string }
    | { readonly platform: "android"; readonly androidProfile: string }
  );

export const POSES: ReadonlyArray<Pose> = [
  {
    id: "iphone-se",
    platform: "ios",
    device: "iPhone SE (3rd generation)",
    iosDeviceType: "iPhone-SE-3rd-generation",
    form: "phone",
    appearance: "light",
  },
  {
    id: "iphone-18-pro-dark",
    platform: "ios",
    device: "iPhone 18 Pro",
    iosDeviceType: "iPhone-18-Pro",
    form: "phone",
    appearance: "dark",
  },
  {
    id: "iphone-duo-folded",
    platform: "ios",
    device: "iPhone Duo",
    iosDeviceType: "iPhone-Duo",
    form: "phone",
    appearance: "light",
    fold: "closed",
    pending: "The device automation cannot reliably accept the iPhone Duo app-opening prompt.",
  },
  {
    id: "iphone-duo-unfolded",
    platform: "ios",
    device: "iPhone Duo",
    iosDeviceType: "iPhone-Duo",
    form: "tablet",
    appearance: "dark",
    fold: "open",
    pending: "The device automation cannot reliably accept the iPhone Duo app-opening prompt.",
  },
  {
    id: "ipad-13-portrait",
    platform: "ios",
    device: "iPad Pro 13-inch (M5)",
    iosDeviceType: "iPad-Pro-13-inch-M5-16GB",
    form: "tablet",
    appearance: "light",
  },
  {
    id: "ipad-13-landscape-large-text",
    platform: "ios",
    device: "iPad Pro 13-inch (M5)",
    iosDeviceType: "iPad-Pro-13-inch-M5-16GB",
    form: "tablet",
    appearance: "dark",
    landscape: true,
    textSize: "accessibility-large",
  },
  {
    id: "pixel-phone-large-text",
    platform: "android",
    device: "Pixel phone",
    androidProfile: "pixel_7_pro",
    form: "phone",
    appearance: "light",
    textSize: "accessibility-large",
  },
  {
    id: "pixel-fold-folded-dark",
    platform: "android",
    device: "Pixel Fold",
    androidProfile: "pixel_fold",
    form: "phone",
    appearance: "dark",
    fold: "closed",
  },
  {
    id: "pixel-fold-unfolded",
    platform: "android",
    device: "Pixel Fold",
    androidProfile: "pixel_fold",
    form: "tablet",
    appearance: "light",
    fold: "open",
  },
  {
    id: "pixel-fold-unfolded-landscape",
    platform: "android",
    device: "Pixel Fold",
    androidProfile: "pixel_fold",
    form: "tablet",
    appearance: "dark",
    fold: "open",
    landscape: true,
  },
  {
    id: "pixel-tablet-portrait",
    platform: "android",
    device: "Pixel Tablet",
    androidProfile: "pixel_tablet",
    form: "tablet",
    appearance: "dark",
  },
  {
    id: "pixel-tablet-landscape",
    platform: "android",
    device: "Pixel Tablet",
    androidProfile: "pixel_tablet",
    form: "tablet",
    appearance: "light",
    landscape: true,
  },
];

export function selectPoses(platform: Pose["platform"] | "all", selected: ReadonlyArray<string>) {
  const unknown = selected.filter((id) => !POSES.some((pose) => pose.id === id));
  if (unknown.length) throw new Error(`Unknown pose: ${unknown.join(", ")}. Use --list.`);
  return POSES.filter(
    (pose) =>
      (platform === "all" || pose.platform === platform) &&
      (selected.length ? selected.includes(pose.id) : !pose.pending),
  );
}
