import { CircleAlertIcon } from "@supaterm/icons";

import { Spinner } from "~/components/ui/spinner";

import { ComposerBanner } from "./ComposerBanner";

export function ComposerActivityRow({ phase }: { readonly phase: "syncing" | "failed" }) {
  const failed = phase === "failed";
  return (
    <ComposerBanner.Row>
      <ComposerBanner.Icon>
        {failed ? <CircleAlertIcon aria-hidden /> : <Spinner />}
      </ComposerBanner.Icon>
      <ComposerBanner.Content>
        <span
          className="shrink-0 whitespace-nowrap text-muted-foreground"
          data-composer-sync-status={phase}
          role={failed ? "alert" : "status"}
        >
          {failed ? "Could not sync messages" : "Syncing messages..."}
        </span>
      </ComposerBanner.Content>
    </ComposerBanner.Row>
  );
}
