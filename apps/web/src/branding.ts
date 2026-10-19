import type { DesktopAppBranding } from "@supaterm/contracts";

function readInjectedDesktopAppBranding(): DesktopAppBranding | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.desktopBridge?.getAppBranding?.() ?? null;
}

const injectedDesktopAppBranding = readInjectedDesktopAppBranding();
const hostedAppChannel = import.meta.env.VITE_HOSTED_APP_CHANNEL?.trim().toLowerCase();

export const HOSTED_APP_CHANNEL =
  hostedAppChannel === "latest" || hostedAppChannel === "nightly" ? hostedAppChannel : null;
export const HOSTED_APP_CHANNEL_LABEL =
  HOSTED_APP_CHANNEL === "nightly" ? "Nightly" : HOSTED_APP_CHANNEL === "latest" ? "Latest" : null;
export const APP_BASE_NAME = injectedDesktopAppBranding?.baseName ?? "Supaterm";
export const APP_STAGE_LABEL = injectedDesktopAppBranding
  ? injectedDesktopAppBranding.stageLabel
  : (HOSTED_APP_CHANNEL_LABEL ?? (import.meta.env.DEV ? "Dev" : null));
export const APP_DISPLAY_NAME = injectedDesktopAppBranding?.displayName ?? APP_BASE_NAME;
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
export const WEBSITE_URL = "https://supaterm.com";
export const SOURCE_CODE_URL = "https://github.com/supabitapp/supaterm";
