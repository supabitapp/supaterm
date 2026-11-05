import { describe, expect, it } from "vite-plus/test";
import { resolveChatCanvasLayout } from "./chatCanvasLayout";
import { resolveThreadDetailsCardLayout } from "./threadDetailsCardLayout";

describe("chat canvas layout", () => {
  it("moves the chat left only as far as a details card it would crowd requires", () => {
    const { chat } = resolveChatCanvasLayout({
      container: { width: 1344, height: 988 },
      maxChatWidth: 736,
      detailsCard: { left: 1052 },
    });
    expect(chat).toMatchObject({ left: 1052 - 32 - 736, width: 736 });
  });
  it("keeps the chat canvas-centered when it clears the details card", () => {
    const result = resolveChatCanvasLayout({
      container: { width: 2200, height: 988 },
      maxChatWidth: 736,
      detailsCard: { left: 1876 },
    });
    expect(result.chat.left).toBe((2200 - 736) / 2);
  });
  it("moves the chat smoothly as a window with a details card grows", () => {
    const leftAt = (width: number) =>
      resolveChatCanvasLayout({
        container: { width, height: 988 },
        maxChatWidth: 736,
        detailsCard: { left: width - 292 },
      }).chat.left;
    for (let width = 1300; width < 1800; width += 1) {
      expect(Math.abs(leftAt(width + 1) - leftAt(width))).toBeLessThanOrEqual(1);
    }
  });
});

describe("workspace card beside chat", () => {
  const withCard = (width: number, maxChatWidth = 736) =>
    resolveChatCanvasLayout({
      container: { width, height: 900 },
      maxChatWidth,
      detailsCard: { left: width - 292 },
    });
  it("keeps chat centered while the card fits beside it", () => {
    expect(withCard(1500).chat).toEqual({ left: 382, width: 736, insetStart: 0, insetEnd: 0 });
  });
  it("narrows chat only after it reaches the left padding", () => {
    expect(withCard(1108).chat).toMatchObject({ left: 48, width: 736 });
    expect(withCard(1028).chat).toEqual({ left: 48, width: 656, insetStart: 0, insetEnd: 276 });
    expect(withCard(1012).chat).toMatchObject({ left: 48, width: 640 });
  });
  it("reserves the marker gutter across widths where the details card fits", () => {
    for (let width = 1012; width <= 1440; width++) {
      const card = resolveThreadDetailsCardLayout({
        container: { width, height: 900 },
        lane: { padding: 48, minChatWidth: 640 },
      })!;
      const chat = withCard(width).chat;
      expect(chat.left).toBeGreaterThanOrEqual(48);
      expect(chat.width).toBeGreaterThanOrEqual(640);
      expect(card.x - chat.left - chat.width).toBeGreaterThanOrEqual(32);
    }
  });
});
