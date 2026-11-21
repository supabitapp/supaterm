import type { LinkedThreadTarget } from "@supaterm/client-runtime/linked-thread";

/** A linked environment's thread as a right panel tab, read through `viaEnvironmentId`. */
export type LinkedThreadSurface = {
  id: `linked-thread:${string}`;
  kind: "linked-thread";
} & LinkedThreadTarget;

/** One tab per thread and the environment it is read through, so opening it again focuses it. */
export function linkedThreadSurface(target: LinkedThreadTarget): LinkedThreadSurface {
  return {
    id: `linked-thread:${encodeURIComponent(target.viaEnvironmentId)}:${encodeURIComponent(target.environmentId)}:${encodeURIComponent(target.threadId)}`,
    kind: "linked-thread",
    viaEnvironmentId: target.viaEnvironmentId,
    environmentId: target.environmentId,
    threadId: target.threadId,
    label: target.label,
    title: target.title,
  };
}

/** A tab's title: the thread's own once known, else where the thread is. */
export function linkedThreadTitle(
  surface: Pick<LinkedThreadTarget, "title">,
  fallback: string,
): string {
  return surface.title?.trim() || fallback;
}
