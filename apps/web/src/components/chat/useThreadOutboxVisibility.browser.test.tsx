import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useThreadOutboxVisibility } from "./useThreadOutboxVisibility";

let root: Root;
let open = false;

function Probe({
  scope = "environment:thread",
  hasPending = true,
  needsAttention = false,
}: {
  scope?: string;
  hasPending?: boolean;
  needsAttention?: boolean;
}) {
  const visible = useThreadOutboxVisibility(scope, hasPending, needsAttention);
  useLayoutEffect(() => {
    open = visible;
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("never opens for a message delivered within one second", () => {
  expect(open).toBe(false);
  act(() => vi.advanceTimersByTime(999));
  expect(open).toBe(false);
  act(() => root.render(<Probe hasPending={false} />));
  act(() => vi.runAllTimers());
  expect(open).toBe(false);
});

it("shows a delayed message without restarting the grace period on updates", () => {
  act(() => vi.advanceTimersByTime(500));
  act(() => root.render(<Probe />));
  act(() => vi.advanceTimersByTime(499));
  expect(open).toBe(false);
  act(() => vi.advanceTimersByTime(1));
  expect(open).toBe(true);
});

it("closes on delivery and gives the next message a fresh grace period", () => {
  act(() => vi.advanceTimersByTime(1_000));
  expect(open).toBe(true);
  act(() => root.render(<Probe hasPending={false} />));
  expect(open).toBe(false);
  act(() => root.render(<Probe />));
  expect(open).toBe(false);
  act(() => vi.advanceTimersByTime(999));
  expect(open).toBe(false);
  act(() => vi.advanceTimersByTime(1));
  expect(open).toBe(true);
});

it("shows failures immediately and keeps the drawer open while retrying or editing", () => {
  act(() => root.render(<Probe needsAttention />));
  expect(open).toBe(true);
  act(() => root.render(<Probe />));
  expect(open).toBe(true);
  act(() => root.render(<Probe hasPending={false} />));
  expect(open).toBe(false);
  act(() => root.render(<Probe />));
  expect(open).toBe(false);
});

it("does not carry visibility or elapsed time to another thread or environment", () => {
  act(() => vi.advanceTimersByTime(1_000));
  expect(open).toBe(true);
  act(() => root.render(<Probe scope="another-environment:thread" />));
  expect(open).toBe(false);
  act(() => vi.advanceTimersByTime(500));
  act(() => root.render(<Probe scope="another-environment:another-thread" />));
  act(() => vi.advanceTimersByTime(999));
  expect(open).toBe(false);
  act(() => vi.advanceTimersByTime(1));
  expect(open).toBe(true);
});

it("shows an existing failure immediately when visiting its thread", () => {
  act(() => root.render(<Probe scope="environment:failed-thread" needsAttention />));
  expect(open).toBe(true);
});
