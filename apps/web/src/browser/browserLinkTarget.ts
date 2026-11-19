import {
  AuthPreviewOperateScope,
  type BrowserLinkTarget,
  type ScopedThreadRef,
} from "@supaterm/contracts";

import { ensureClientSettingsHydrated, getClientSettings } from "~/hooks/useSettings";
import { readEnvironmentScope } from "~/state/session";
import { isPreviewAvailableFor } from "./previewRuntime";
import { isWebUrl } from "./webUrl";

export { isWebUrl };

export interface ResolveLinkTargetInput {
  readonly url: string;
  readonly event: {
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
    readonly button?: number | undefined;
  };
  readonly preference: BrowserLinkTarget;
  readonly canOpenInApp: boolean;
}

export function resolveLinkTarget(input: ResolveLinkTargetInput): BrowserLinkTarget;
export function resolveLinkTarget(input: ResolveLinkTargetInput) {
  if (input.event.metaKey || input.event.ctrlKey || input.event.button === 1)
    return "system" satisfies BrowserLinkTarget;
  if (input.preference !== "app") return "system" satisfies BrowserLinkTarget;
  if (!input.canOpenInApp) return "system" satisfies BrowserLinkTarget;
  if (!isWebUrl(input.url)) return "system" satisfies BrowserLinkTarget;
  return "app" satisfies BrowserLinkTarget;
}

/** Before hydration, the default "system" would ignore a saved "app" link target. */
export function resolveBrowserLinkTargetPreference(): Promise<BrowserLinkTarget>;
export async function resolveBrowserLinkTargetPreference() {
  await ensureClientSettingsHydrated();
  return getClientSettings().browserLinkTarget satisfies BrowserLinkTarget;
}

export function canOpenLinksInApp(threadRef: ScopedThreadRef | null | undefined): boolean;
export function canOpenLinksInApp(threadRef: ScopedThreadRef | null | undefined) {
  return (threadRef != null &&
    readEnvironmentScope(threadRef.environmentId, AuthPreviewOperateScope) &&
    isPreviewAvailableFor(threadRef.environmentId)) satisfies boolean;
}
