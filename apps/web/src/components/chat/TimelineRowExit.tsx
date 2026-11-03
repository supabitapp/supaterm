import type { ReactNode } from "react";

export const TIMELINE_ROW_EXIT_MS = 200;

export function TimelineRowExit({ exiting, children }: { exiting: boolean; children: ReactNode }) {
  return (
    <div
      inert={exiting}
      data-ending-style={exiting ? "" : undefined}
      style={{ transitionDuration: `${TIMELINE_ROW_EXIT_MS}ms` }}
      className="grid grid-rows-[1fr] transition-[grid-template-rows,opacity] ease-drawer motion-reduce:transition-none data-ending-style:grid-rows-[0fr] data-ending-style:opacity-0"
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
