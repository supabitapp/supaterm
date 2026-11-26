import type { ChangeRequestTerminology } from "@supaterm/client-runtime/source-control-clients";
import { m } from "~/i18n/messages";
import { msg } from "gt-react";

export function offHeadPullRequestCheckoutToast(terminology: ChangeRequestTerminology) {
  return {
    type: "warning",
    title: m(msg("Checked out, but not confirmed on the latest commit")),
    description: `This checkout could not be confirmed at the ${terminology.singular}'s latest commit, so its code may differ. Local commits or uncommitted work keep a checkout where it is.`,
  } as const;
}
