import { ChevronDownIcon } from "@supaterm/icons";

import { usePresence } from "~/hooks/usePresence";
import { Button } from "../ui/button";

export function ScrollToEndPill({
  show,
  bottom,
  onScrollToEnd,
}: {
  show: boolean;
  bottom: number;
  onScrollToEnd: () => void;
}) {
  const presence = usePresence(show ? true : null);
  if (!presence.value) return null;
  return (
    <div
      {...presence.props}
      inert={presence.exiting}
      className="chat-scroll-to-bottom pointer-events-none absolute z-30 flex justify-center py-1.5 transition-[translate,scale] duration-200 ease-drawer data-enter:starting:translate-y-1 data-enter:starting:scale-95 data-ending-style:translate-y-1 data-ending-style:scale-95 data-ending-style:duration-150 data-ending-style:ease-in motion-reduce:transition-none"
      style={{ bottom }}
    >
      <Button
        aria-label="Scroll to end"
        onPointerDown={(event) => event.preventDefault()}
        onClick={onScrollToEnd}
        className="pointer-events-auto"
        size="xs"
        variant="glass"
      >
        <ChevronDownIcon className="size-3.5" />
        Scroll to end
      </Button>
    </div>
  );
}
