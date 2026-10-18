import type { EnvironmentId, ScopedThreadRef, ThreadPullRequestLink } from "@supaterm/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import {
  normalizeThreadPullRequestKey,
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@supaterm/shared/threadPullRequests";
import { parseChangeRequestUrl } from "~/lib/openPullRequestLink";
import { useServerConfigs } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

/** Links and unlinks pull requests on the threads of one connected environment. */
export function usePullRequestLinking(environmentId: EnvironmentId | null | undefined) {
  const configs = useServerConfigs();
  const supported = environmentId != null && configs.get(environmentId) !== undefined;
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
