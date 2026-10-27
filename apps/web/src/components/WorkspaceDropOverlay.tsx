import { PaperclipIcon } from "@supaterm/icons";

import { usePresence } from "~/hooks/usePresence";

export function WorkspaceDropOverlay({ active }: { active: boolean }) {
  const presence = usePresence(active ? true : null);
  if (!presence.value) return null;
  return (
    <div
      {...presence.props}
      className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/[0.035] transition-opacity duration-150 ease-drawer data-enter:starting:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-100 data-ending-style:ease-in motion-reduce:transition-none"
      data-chat-workspace-drop-overlay="true"
    >
      <div
        role="status"
        className="flex items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg"
      >
        <PaperclipIcon className="size-4 text-primary" aria-hidden="true" />
        Drop files to attach
      </div>
    </div>
  );
}
