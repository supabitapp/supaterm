import { useEffect, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { observeIntersection } from "~/lib/observeIntersection";
import { DiffFileHeaderSkeleton } from "../DiffPanelShell";

export function DiffFileLoadingBoundary({ load, count }: { load: () => void; count: number }) {
  const [isNear, setIsNear] = useState(false);
  const loadLatest = useStableCallback(load);
  const observe = (node: HTMLDivElement | null) => {
    if (!node) return;
    return observeIntersection(node, (entry) => setIsNear(entry.isIntersecting), {
      rootMargin: "600px",
    });
  };
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- requests the next diff batch while the boundary is near the viewport and files remain
  useEffect(() => {
    if (isNear && count > 0) loadLatest();
  }, [isNear, count, loadLatest]);

  return (
    <div ref={observe} role="status" aria-label="Loading diff…">
      {Array.from({ length: Math.min(count, 4) }, (_, index) => (
        <div key={index} aria-hidden className="border-b border-border/40">
          <DiffFileHeaderSkeleton titleWidth="medium" />
        </div>
      ))}
    </div>
  );
}
