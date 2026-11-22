import { composerTargetKey, type ComposerThreadTarget } from "../../composerDraftStore";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { usePreparingComposerImages } from "./preparingComposerImages";

export const HELD_COMPOSER_SEND_BANNER_ID = "held-composer-send";

function HeldComposerSendStatus({ draftTarget }: { readonly draftTarget: ComposerThreadTarget }) {
  const preparingCount = usePreparingComposerImages(composerTargetKey(draftTarget)).length;
  const label =
    preparingCount === 0
      ? "Sending message"
      : preparingCount === 1
        ? "Sending once image is ready"
        : `Sending once ${preparingCount} images are ready`;
  return <span aria-live="polite">{label}</span>;
}

/** Shown while a send waits for pasted or dropped images to finish compressing. */
export function heldComposerSendBannerItem(input: {
  readonly draftTarget: ComposerThreadTarget;
  readonly onCancel: () => void;
}): ComposerBannerStackItem {
  return {
    id: HELD_COMPOSER_SEND_BANNER_ID,
    variant: "info",
    icon: <Spinner size="xs" aria-hidden="true" />,
    title: <HeldComposerSendStatus draftTarget={input.draftTarget} />,
    description: "Edit or press Esc to cancel",
    actions: (
      <Button
        size="xs"
        variant="ghost"
        onPointerDown={(event) => event.preventDefault()}
        onClick={input.onCancel}
      >
        Cancel
      </Button>
    ),
  };
}
