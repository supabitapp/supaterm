import { useGT } from "gt-react";
import { Skeleton } from "../ui/skeleton";

export function ThreadTimelineLoading({ bottomInset = 0 }: { bottomInset?: number }) {
  const gt = useGT();
  return (
    <div
      role="status"
      aria-label={gt("Loading conversation")}
      aria-busy="true"
      data-timeline-loading="true"
      className="pointer-events-none flex h-full min-h-0 flex-col justify-end overflow-hidden bg-background px-3 pt-6 sm:px-12"
      style={{ paddingBottom: bottomInset + 24 }}
    >
      <div
        aria-hidden="true"
        className="chat-content-lane flex flex-col gap-7 ps-(--chat-lane-inset-start) pe-(--chat-lane-inset-end)"
      >
        <div className="space-y-3 px-2">
          <Skeleton shape="pill" className="h-2.5 w-[42%]" />
          <Skeleton shape="pill" className="h-3 w-[86%]" />
          <Skeleton shape="pill" className="h-3 w-[58%]" />
        </div>
        <div className="w-[70%] self-end space-y-3 rounded-2xl bg-muted/40 p-4">
          <Skeleton shape="pill" className="h-3 w-full" />
          <Skeleton shape="pill" className="h-3 w-[68%]" />
        </div>
        <div className="space-y-3 px-2">
          <Skeleton shape="pill" className="h-2.5 w-[34%]" />
          <Skeleton shape="pill" className="h-3 w-full" />
          <Skeleton shape="pill" className="h-3 w-[92%]" />
          <Skeleton shape="pill" className="h-3 w-[72%]" />
        </div>
      </div>
    </div>
  );
}
