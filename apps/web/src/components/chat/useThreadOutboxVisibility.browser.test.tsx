import { useLayoutEffect } from "react";
import { act, render as renderUi, fakeTimers, type Screen } from "../../../test/render";
import { expect, it, vi } from "vite-plus/test";

import { useThreadOutboxVisibility } from "./useThreadOutboxVisibility";

let screen: Screen;
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

async function setupTest() {
  await using resources = new AsyncDisposableStack();

  resources.use(fakeTimers());
  screen = resources.use(await renderUi(<Probe />, { router: false }));

  return resources.move();
}

it("never opens for a message delivered within one second", async () => {
  await using _test = await setupTest();
  expect(open).toBe(false);
  await act(() => vi.advanceTimersByTime(999));
  expect(open).toBe(false);
  await screen.rerender(<Probe hasPending={false} />);
  await act(() => vi.runAllTimers());
  expect(open).toBe(false);
});

it("shows a delayed message without restarting the grace period on updates", async () => {
  await using _test = await setupTest();
  await act(() => vi.advanceTimersByTime(500));
  await screen.rerender(<Probe />);
  await act(() => vi.advanceTimersByTime(499));
  expect(open).toBe(false);
  await act(() => vi.advanceTimersByTime(1));
  expect(open).toBe(true);
});

it("closes on delivery and gives the next message a fresh grace period", async () => {
  await using _test = await setupTest();
  await act(() => vi.advanceTimersByTime(1_000));
  expect(open).toBe(true);
  await screen.rerender(<Probe hasPending={false} />);
  expect(open).toBe(false);
  await screen.rerender(<Probe />);
  expect(open).toBe(false);
  await act(() => vi.advanceTimersByTime(999));
  expect(open).toBe(false);
  await act(() => vi.advanceTimersByTime(1));
  expect(open).toBe(true);
});

it("shows failures immediately and keeps the drawer open while retrying or editing", async () => {
  await using _test = await setupTest();
  await screen.rerender(<Probe needsAttention />);
  expect(open).toBe(true);
  await screen.rerender(<Probe />);
  expect(open).toBe(true);
  await screen.rerender(<Probe hasPending={false} />);
  expect(open).toBe(false);
  await screen.rerender(<Probe />);
  expect(open).toBe(false);
});

it("does not carry visibility or elapsed time to another thread or environment", async () => {
  await using _test = await setupTest();
  await act(() => vi.advanceTimersByTime(1_000));
  expect(open).toBe(true);
  await screen.rerender(<Probe scope="another-environment:thread" />);
  expect(open).toBe(false);
  await act(() => vi.advanceTimersByTime(500));
  await screen.rerender(<Probe scope="another-environment:another-thread" />);
  await act(() => vi.advanceTimersByTime(999));
  expect(open).toBe(false);
  await act(() => vi.advanceTimersByTime(1));
  expect(open).toBe(true);
});

it("shows an existing failure immediately when visiting its thread", async () => {
  await using _test = await setupTest();
  await screen.rerender(<Probe scope="environment:failed-thread" needsAttention />);
  expect(open).toBe(true);
});
