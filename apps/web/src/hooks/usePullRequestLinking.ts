import type { EnvironmentId, ScopedThreadRef, ThreadPullRequestLink } from "@supaterm/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import {
  normalizeThreadPullRequestKey,
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@supaterm/client-runtime/thread-pull-requests";
import { parseChangeRequestUrl } from "~/lib/openPullRequestLink";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { environmentServerConfigsAtom } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

// A boolean, so provider status pushes and snapshots that keep the environment's
// config present don't re-render every link renderer.
const linkSupportedAtom = Atom.family((environmentId: EnvironmentId | null) =>
  Atom.make(
    (get) =>
      environmentId !== null && get(environmentServerConfigsAtom).get(environmentId) !== undefined,
  ).pipe(Atom.withLabel("pull-request-link-supported")),
);

/** Links and unlinks pull requests on the threads of one connected environment. */
export function usePullRequestLinking(environmentId: EnvironmentId | null | undefined) {
  const supported = useAtomValue(linkSupportedAtom(environmentId ?? null));
  const link = useAtomCommand(threadEnvironment.linkPullRequest, { reportFailure: false });
  const unlink = useAtomCommand(threadEnvironment.unlinkPullRequest, { reportFailure: false });
  const canLink = (url: string) => supported && parseChangeRequestUrl(url) !== null;
  const isLinked = (
    thread: { readonly pullRequests?: readonly ThreadPullRequestLink[] } | null,
    url: string,
  ) => {
    if (thread === null || !supported) return false;
    const parsed = parseChangeRequestUrl(url);
    return (
      parsed !== null &&
      visibleThreadPullRequests(thread.pullRequests ?? []).some((entry) =>
        threadPullRequestKeysEqual(entry, parsed),
      )
    );
  };
  const changeLink = async (threadRef: ScopedThreadRef, url: string, linked: boolean) => {
    const parsed = parseChangeRequestUrl(url);
    if (parsed === null || threadRef.environmentId !== environmentId || !supported)
      throw new Error("The pull request is not available in this environment.");
    const reference = { ...parsed, url };
    const key = normalizeThreadPullRequestKey(reference);
    const result = await (linked
      ? link({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, ...reference, ...key, source: "manual" },
        })
      : unlink({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, ...key },
        }));
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) throw new Error("Link update interrupted.");
      throw squashAtomCommandFailure(result);
    }
  };
  return { supported, canLink, isLinked, changeLink };
}
