import { ChevronDownIcon } from "@supaterm/icons";

import { Button } from "../ui/button";

export function ScrollToEndButton(props: {
  readonly bottom: number;
  readonly summary: string | null;
  readonly onScrollToEnd: () => void;
}) {
  return (
    <div
      className="chat-scroll-to-bottom pointer-events-none absolute z-30 flex justify-center py-1.5"
      style={{ bottom: props.bottom }}
    >
      <Button
        data-scroll-to-end="true"
        onPointerDown={(event) => event.preventDefault()}
        onClick={props.onScrollToEnd}
        className="pointer-events-auto"
        size="xs"
        variant="glass"
      >
        <ChevronDownIcon className="size-3.5" />
        Scroll to end
        {props.summary === null ? null : (
          <span className="text-muted-foreground">
            <span aria-hidden>· </span>
            {props.summary}
          </span>
        )}
      </Button>
    </div>
  );
}
