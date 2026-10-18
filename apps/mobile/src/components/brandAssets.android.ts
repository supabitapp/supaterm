const appVariant = process.env.EXPO_PUBLIC_APP_VARIANT;

export const SUPATERM_BRAND_MARK_SOURCE =
  appVariant === "development"
    ? require("../../assets/android-icon-dev.png")
    : appVariant === "preview"
      ? require("../../assets/android-icon-nightly.png")
      : require("../../assets/android-icon-prod.png");
