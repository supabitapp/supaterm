import { PinIcon } from "@supaterm/icons";

import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import { useClientSettings } from "~/hooks/useSettings";

import { InlineConfirmIcon, InlineConfirmTooltip } from "../InlineConfirm";

export function SidebarPinButton({
  pinned,
  shortcut,
  onPin,
  onUnpin,
}: {
  pinned: boolean;
  shortcut: string | null;
  onPin: () => void;
  onUnpin: () => void;
}) {
  const confirmThreadUnpin = useClientSettings((settings) => settings.confirmThreadUnpin);
  const confirm = useInlineConfirm<"unpin">();
  const armed = pinned && confirm.armed === "unpin";
  const target =
    pinned && confirmThreadUnpin
      ? confirm.bind("unpin", onUnpin)
      : { onClick: pinned ? onUnpin : onPin };
  const label = pinned ? "Unpin thread" : "Pin thread";
  return (
    <InlineConfirmTooltip
      armed={armed}
      required={pinned && confirmThreadUnpin}
      tip={label}
      armedTip="Click again to unpin"
      shortcut={shortcut}
      render={
        <button
          type="button"
          aria-label={armed ? "Confirm unpin" : label}
          {...target}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            target.onClick(event);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className="inline-flex h-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/65 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_svg]:size-3.5"
        />
      }
    >
      <InlineConfirmIcon armed={armed}>
        <PinIcon aria-hidden fill={pinned ? "currentColor" : "none"} />
      </InlineConfirmIcon>
    </InlineConfirmTooltip>
  );
}
