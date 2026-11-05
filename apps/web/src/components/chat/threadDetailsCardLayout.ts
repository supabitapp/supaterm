import { DETAILS_CARD_CLEARANCE } from "./chatCanvasLayout";

export const THREAD_DETAILS_CARD_GAP = 12;
// Keep in sync with --thread-details-panel-width.
const THREAD_DETAILS_CARD_WIDTH = 264;

export function resolveThreadDetailsCardDensity(
  height: number,
  content: { full: number; compact: number },
) {
  if (content.full === 0 || content.full <= height) return "full";
  if (content.compact === 0 || content.compact <= height) return "compact";
  return "essential";
}

export function resolveThreadDetailsCardLayout({
  container,
  lane,
}: {
  container: { width: number; height: number };
  lane: { padding: number; minChatWidth: number };
}) {
  const gap = THREAD_DETAILS_CARD_GAP;
  const width = THREAD_DETAILS_CARD_WIDTH;
  const x = container.width - width - gap;
  if (x - DETAILS_CARD_CLEARANCE - lane.padding < lane.minChatWidth) return null;
  const y = gap;
  const height = container.height - y - gap;
  if (height < 160) return null;
  return {
    x,
    right: gap,
    width,
    y,
    height,
  } as const;
}
