import type { ServerUpdateState } from "@supaterm/client-runtime/state/server";
import { CircleAlertIcon, DownloadIcon } from "@supaterm/icons";

// Static on purpose: the title says when an update is running, and spinners repaint every frame.
export function ComposerServerUpdateIcon({
  status,
}: {
  readonly status: ServerUpdateState["status"];
}) {
  if (status === "failed") {
    return <CircleAlertIcon aria-hidden className="text-error" />;
  }
  return <DownloadIcon aria-hidden />;
}
