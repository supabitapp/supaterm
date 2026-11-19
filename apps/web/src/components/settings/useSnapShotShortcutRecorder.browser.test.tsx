import { act, render } from "../../../test/render";
import { DEFAULT_CLIENT_SETTINGS } from "@supaterm/contracts";
import { userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

const { fake } = vi.hoisted(() => ({
  fake: <
    F extends (...args: never[]) => unknown = { call(...args: Array<unknown>): unknown }["call"],
  >(
    initial?: F,
  ) => {
    const script = { queue: [] as Array<F>, fallback: initial };
    const target = {
      call: (...args: Parameters<F>) =>
        (script.queue.shift() ?? script.fallback)?.(...args) as ReturnType<F>,
    };
    const spy = vi.spyOn(target, "call");
    const scripted = Object.assign(spy, {
      implement: (next: F) => {
        script.fallback = next;
        return scripted;
      },
      implementOnce: (next: F) => {
        script.queue.push(next);
        return scripted;
      },
      reset: (next?: F) => {
        script.queue = [];
        script.fallback = next ?? initial;
        spy.mockClear();
        return scripted;
      },
    });
    return scripted;
  },
}));
const suppress = vi.hoisted(() => fake<(enabled: boolean) => Promise<void>>());
vi.mock(import("../../lib/desktopSnapShot"), async (original) => ({
  ...(await original()),
  getDesktopSnapShotBridge: () => ({ setSnapShotShortcutSuppressed: suppress }) as never,
}));

import { useSnapShotShortcutRecorder } from "./useSnapShotShortcutRecorder";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const recorded = vi.fn();
const error = vi.fn();

function Recorder(props: { allowModifierPairs?: boolean; shortcutLabel?: string }) {
  const recorder = useSnapShotShortcutRecorder({
    shortcut: DEFAULT_CLIENT_SETTINGS.snapShotShortcut,
    shortcutLabel: props.shortcutLabel,
    allowModifierPairs: props.allowModifierPairs ?? false,
    onRecord: recorded,
    onError: error,
  });
  return recorder.input;
}

function setup() {
  suppress.reset(async () => undefined);
  recorded.mockReset();
  error.mockReset();
}
async function renderRecorder(props: Parameters<typeof Recorder>[0] = {}) {
  const screen = await render(<Recorder {...props} />);
  const button = () =>
    screen.container.querySelector<HTMLButtonElement>("[data-keybinding-capture]")!;
  const expectRecording = async (recording: boolean) =>
    await expect
      .element(screen.getByRole("button"))
      .toHaveAttribute("aria-pressed", String(recording));
  return {
    ...screen,
    button,
    expectRecording,
    async start() {
      await userEvent.click(button());
      await expectRecording(true);
    },
  };
}

it("ignores late suppression acknowledgements after cancellation", async () => {
  setup();
  const pending = deferred<void>();
  suppress.implement((enabled) => (enabled ? pending.promise : Promise.resolve()));
  await using screen = await renderRecorder();
  const { button } = screen;
  await userEvent.click(button());
  await act(async () => button().blur());
  await act(async () => pending.resolve());
  await screen.expectRecording(false);
  expect(suppress).toHaveBeenLastCalledWith(false);
  expect(recorded).not.toHaveBeenCalled();
});
