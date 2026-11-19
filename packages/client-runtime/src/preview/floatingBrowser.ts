import type { PreviewNavStatus } from "@supaterm/contracts";

/** Reveal a page after it loads, retaining it through subsequent navigations. */
export function shouldShowFloatingBrowser(
  navStatus: PreviewNavStatus | null,
  wasVisible: boolean,
): boolean {
  if (!navStatus || navStatus._tag === "Idle" || navStatus._tag === "LoadFailed") return false;
  const url = navStatus.url.trim();
  if (!url || /^about:blank(?:[?#]|$)/i.test(url) || /^chrome-error:\/\//i.test(url)) {
    return false;
  }
  return navStatus._tag === "Success" || wasVisible;
}
