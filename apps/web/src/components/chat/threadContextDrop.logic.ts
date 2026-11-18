import type { ScopedThreadRef } from "@supaterm/contracts";
import { threadContextRecord } from "@supaterm/shared/composerContextReferences";

export type ThreadContextDropRef = ScopedThreadRef & { readonly title?: string };

export function droppedThreadContextRecord(
  ref: ThreadContextDropRef,
  shell: { readonly title: string } | null,
) {
  const title = ref.title ?? shell?.title;
  return title === undefined ? null : threadContextRecord(ref, title);
}
