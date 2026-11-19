import { INLINE_CONFIRM_GUARD_MS } from "@supaterm/client-runtime/inline-confirm";
import { act } from "react";

export function clickAt(target: Element, timeStamp: number): void {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  target.dispatchEvent(event);
}

export function clickOnFakeClock(target: Element): void {
  clickAt(target, Date.now());
}

export function pressAgain(target: Element): Promise<void> {
  return act(async () => clickAt(target, performance.now() + INLINE_CONFIRM_GUARD_MS));
}

export async function pressTwice(target: HTMLElement): Promise<void> {
  await act(async () => target.click());
  await pressAgain(target);
}
