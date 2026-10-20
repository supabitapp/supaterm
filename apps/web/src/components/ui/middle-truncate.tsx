import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

export function MiddleTruncate({
  value,
  tail,
  showTitle = true,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  value: string;
  tail?: number;
  showTitle?: boolean;
}) {
  const split = splitForMiddleTruncate(value, tail);
  return (
    <span
      {...(showTitle ? { title: value } : {})}
      className={cn("inline-flex min-w-0 max-w-full overflow-hidden whitespace-nowrap", className)}
      {...props}
    >
      {split ? (
        <>
          <span className="min-w-0 truncate">{split.head}</span>
          <span className="shrink-0">{split.tail}</span>
        </>
      ) : (
        <span className="min-w-0 truncate">{value}</span>
      )}
    </span>
  );
}

const DEFAULT_TAIL = 10;
const MAX_SEGMENT_TAIL = 16;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function splitForMiddleTruncate(
  value: string,
  tail?: number,
): { head: string; tail: string } | null {
  // Graphemes, not code points: head and tail render as separate flex items, so a cut
  // inside a combining sequence or a joined emoji would render its pieces as broken glyphs.
  const chars = Array.from(graphemeSegmenter.segment(value), (part) => part.segment);
  let keep = tail ?? DEFAULT_TAIL;
  if (tail === undefined) {
    const slash = chars.lastIndexOf("/");
    if (slash > 0 && slash < chars.length - 1) {
      const segment = chars.length - slash - 1;
      keep = segment <= MAX_SEGMENT_TAIL ? segment : DEFAULT_TAIL;
    }
  }
  if (keep <= 0 || chars.length <= keep + 4) return null;
  const cut = chars.length - keep;
  return { head: chars.slice(0, cut).join(""), tail: chars.slice(cut).join("") };
}
