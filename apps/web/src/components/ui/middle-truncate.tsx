import { type ComponentProps, useLayoutEffect, useRef } from "react";

import { observeResize } from "~/lib/observeResize";
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
  const headRef = useRef<HTMLSpanElement>(null);
  const head = split?.head;
  // oxlint-disable-next-line supaterm/react-effect-budget -- Fits the head span's DOM text and refits it through a ResizeObserver.
  useLayoutEffect(() => {
    const element = headRef.current;
    // A new head can keep the same box size, so refit here, not only on resize.
    if (!element || head === undefined) return;
    fitHead(element);
    return observeResize(element, () => fitHead(element));
  }, [head]);
  return (
    <span
      {...(showTitle ? { title: value } : {})}
      className={cn("inline-flex min-w-0 max-w-full overflow-hidden whitespace-nowrap", className)}
      {...props}
    >
      {split ? (
        <>
          {/* The tail carries the ellipsis so it sits flush; a CSS ellipsis leaves a ragged gap. */}
          <span ref={headRef} className="peer min-w-0 overflow-hidden">
            {split.head}
          </span>
          <span className="shrink-0 peer-data-overflow:before:content-['…']">{split.tail}</span>
        </>
      ) : (
        // Keyed so React does not reuse the head node and its imperative clip.
        <span key="whole" className="min-w-0 truncate">
          {value}
        </span>
      )}
    </span>
  );
}

// An overflowing head is cut after its last whole grapheme: clip the partial glyph
// and slide the tail left over the slack. Neither changes layout, so the observed
// size stays the true available width.
function fitHead(head: HTMLElement) {
  const text = head.firstChild;
  const overflowing = head.scrollWidth > head.clientWidth && text instanceof Text;
  head.toggleAttribute("data-overflow", overflowing);
  let slack = 0;
  if (overflowing) {
    const range = document.createRange();
    const left = head.getBoundingClientRect().left;
    // Range offsets count UTF-16 units; only grapheme boundaries are valid cuts.
    const boundaries = [0];
    for (const part of graphemeSegmenter.segment(text.data)) {
      boundaries.push(part.index + part.segment.length);
    }
    const widthTo = (boundary: number) => {
      range.setStart(text, 0);
      range.setEnd(text, boundaries[boundary]!);
      return range.getBoundingClientRect().right - left;
    };
    let fits = 0;
    let over = boundaries.length - 1;
    while (over - fits > 1) {
      const mid = (fits + over) >> 1;
      if (widthTo(mid) <= head.clientWidth) fits = mid;
      else over = mid;
    }
    slack = Math.max(0, head.clientWidth - widthTo(fits));
  }
  head.style.clipPath = slack > 0 ? `inset(-0.25em ${slack}px -0.25em 0)` : "";
  const tail = head.nextElementSibling;
  if (tail instanceof HTMLElement) tail.style.translate = slack > 0 ? `-${slack}px 0` : "";
}

const DEFAULT_TAIL = 10;
const MAX_SEGMENT_TAIL = 16;
const MIN_WORD_TAIL = 4;
const WORD_BREAK = /[-_./]/;
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
  let cut = chars.length - keep;
  // Start an automatic tail on a word ("machine", not "er-machine"). A shorter tail is
  // preferred so the head stays readable; a longer one is the fallback.
  if (tail === undefined && !WORD_BREAK.test(chars[cut - 1]!)) {
    const startsWord = (index: number) => WORD_BREAK.test(chars[index - 1]!);
    let snapped = -1;
    for (let index = cut + 1; index <= chars.length - MIN_WORD_TAIL; index++) {
      if (startsWord(index)) {
        snapped = index;
        break;
      }
    }
    for (
      let index = cut - 1;
      snapped < 0 && index >= chars.length - MAX_SEGMENT_TAIL && index > 4;
      index--
    ) {
      if (startsWord(index)) snapped = index;
    }
    if (snapped > 0) cut = snapped;
  }
  return { head: chars.slice(0, cut).join(""), tail: chars.slice(cut).join("") };
}
