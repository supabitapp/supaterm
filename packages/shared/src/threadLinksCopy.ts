import type { EnvironmentId, ScopedThreadRef } from "@supaterm/contracts";

import { relabelThreadLinks as relabelThreadLinksWith, type ThreadLink } from "./threadLinks.ts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

/** @public */
export function unknownThreadLinkLabel(
  link: ThreadLink,
  messageEnvironmentId: EnvironmentId,
  resolve: MFunctionType = mFallback,
): string {
  return link.environmentId === null || link.environmentId === messageEnvironmentId
    ? resolve(msg("Thread no longer available"))
    : resolve(msg("Thread on another machine"));
}

/**
 * Writes each link with its thread's current title. A link `title` cannot resolve becomes plain
 * text, its written label or a neutral one, except a labeled v1 link, which may open elsewhere.
 */
export function relabelThreadLinks(
  markdown: string,
  messageEnvironmentId: EnvironmentId,
  title: (ref: ScopedThreadRef) => string | undefined,
  resolve: MFunctionType = mFallback,
): string {
  return relabelThreadLinksWith(markdown, messageEnvironmentId, title, (link, environmentId) =>
    unknownThreadLinkLabel(link, environmentId, resolve),
  );
}
