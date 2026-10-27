import { BookmarkIcon } from "@supaterm/icons";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { ComposerBanner } from "./ComposerBanner";

export const ComposerStashBadge = memo(function ComposerStashBadge(props: {
  count: number;
  menuOpen: boolean;
  pulseKey: number;
  pulsing: boolean;
  onToggleMenu: () => void;
}) {
  if (props.count === 0) return null;
  const count = (
    <ComposerBanner.Count
      key={props.pulseKey}
      className={cn(
        "transition-[color,opacity,translate] duration-200 ease-out motion-reduce:transition-none",
        props.pulsing
          ? "text-primary starting:translate-y-0.5 starting:opacity-0"
          : "text-muted-foreground",
      )}
    >
      {props.count}
    </ComposerBanner.Count>
  );

  return (
    <ComposerBanner.Root density="comfortable" width="content" className="ml-auto">
      <ComposerBanner.Row
        render={<button type="button" />}
        data-prompt-stash-badge="true"
        aria-label={`Stashed prompts: ${props.count}. Open stash.`}
        aria-expanded={props.menuOpen}
        className={cn(
          "transition-colors duration-200",
          props.menuOpen && "pointer-events-none",
          props.menuOpen || props.pulsing
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
        onPointerDown={(event) => event.preventDefault()}
        onClick={props.onToggleMenu}
      >
        <ComposerBanner.Icon>
          <BookmarkIcon />
        </ComposerBanner.Icon>
        <ComposerBanner.Content>Stash</ComposerBanner.Content>
        <ComposerBanner.Actions>{count}</ComposerBanner.Actions>
      </ComposerBanner.Row>
    </ComposerBanner.Root>
  );
});
