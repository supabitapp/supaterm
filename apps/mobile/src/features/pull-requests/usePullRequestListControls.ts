import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { DEFAULT_PR_LIST_CONTROLS, type PullRequestListControls } from "./pullRequestList";
export function usePullRequestListControls() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const saved = AsyncResult.isSuccess(preferences)
    ? preferences.value.pullRequestListFilters
    : undefined;
  const environmentId = saved?.environmentId ?? null;
  const controlsFor = (environment: string | null) =>
    saved?.controls[environment ?? ""] ?? DEFAULT_PR_LIST_CONTROLS;
  const setEnvironmentId = (next: string | null) => {
    void savePreferences({
      transform: (current) => ({
        pullRequestListFilters: {
          controls: current.pullRequestListFilters?.controls ?? {},
          environmentId: next,
        },
      }),
    });
  };
  const setControls = (environment: string | null, controls: PullRequestListControls) => {
    void savePreferences({
      transform: (current) => ({
        pullRequestListFilters: {
          environmentId: current.pullRequestListFilters?.environmentId ?? null,
          controls: withEnvironmentControls(
            current.pullRequestListFilters?.controls,
            environment ?? "",
            controls,
          ),
        },
      }),
    });
  };
  const reset = () => {
    void savePreferences({
      pullRequestListFilters: {
        environmentId: null,
        controls: {},
      },
    });
  };
  return {
    environmentId,
    controlsFor,
    setEnvironmentId,
    setControls,
    reset,
  } as const;
}
function withEnvironmentControls(
  saved: Readonly<Record<string, PullRequestListControls>> | undefined,
  environment: string,
  controls: PullRequestListControls,
): Record<string, PullRequestListControls> {
  return {
    ...saved,
    [environment]: controls,
  };
}
