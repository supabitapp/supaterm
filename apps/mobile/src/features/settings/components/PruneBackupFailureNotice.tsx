import { useAtomValue } from "@effect/atom-react";
import { useGT } from "gt-react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { serverEnvironment } from "../../../state/server";
import type { SettingsTarget } from "../settings-environment-filter";

const formatGiB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

/** Says why history pruning has deleted nothing on each machine whose one-time backup failed. */
export function PruneBackupFailureNotice({
  targets,
}: {
  readonly targets: readonly SettingsTarget[];
}) {
  const gt = useGT();
  const failures = useAtomValue(
    serverEnvironment.databasePruneBackupFailures(
      JSON.stringify(targets.map((target) => target.environmentId)),
    ),
  );
  return failures.map(({ environmentId, failure }) => {
    const environment =
      targets.find((target) => target.environmentId === environmentId)?.label ?? environmentId;
    return (
      <Text
        key={environmentId}
        accessibilityRole="alert"
        className="px-4 pb-3 text-sm text-danger-foreground"
      >
        {failure._tag === "InsufficientSpace"
          ? gt(
              "Nothing deleted on {environment}: the one-time backup needs {needed} of free disk space, and {free} is free.",
              {
                environment,
                needed: formatGiB(failure.neededBytes),
                free: formatGiB(failure.freeBytes),
              },
            )
          : gt(
              "Nothing deleted on {environment}: the one-time backup failed. The server log has the details.",
              { environment },
            )}
      </Text>
    );
  });
}
