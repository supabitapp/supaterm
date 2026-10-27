import { Spinner } from "~/components/ui/spinner";
import type { ServerUpdateState } from "@supaterm/client-runtime/state/server";
import { CircleAlertIcon, DownloadIcon } from "@supaterm/icons";

export function ComposerServerUpdateIcon({
  status,
}: {
  readonly status: ServerUpdateState["status"];
}) {
  if (status === "running") {
    return <Spinner aria-hidden />;
  }
  if (status === "failed") {
    return <CircleAlertIcon aria-hidden className="text-error" />;
  }
  return <DownloadIcon aria-hidden />;
}
