import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { useAttachmentExits, useAttachmentTrayMotion } from "./composerAttachmentMotion";

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Tray({ initial }: { initial: string[] }) {
  const [ids, setIds] = useState(initial);
  const { trayRef, tray } = useAttachmentTrayMotion("draft", ids, "layout", false);
  const exits = useAttachmentExits(tray, ids, (id) => id);
  return (
    <div ref={trayRef} data-draft={ids.join(" ")}>
      {exits.items.map((id) => (
        <button
          key={id}
          type="button"
          {...exits.presence(id)}
          onClick={() =>
            exits.exit(id, () => setIds((current) => current.filter((other) => other !== id)))
          }
        >
          {id}
        </button>
      ))}
    </div>
  );
}

async function mountTray(initial: string[]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const exits = new Map<string, { finished: Promise<void>; finish: () => void }>();
  const exitOf = (id: string) => {
    let exit = exits.get(id);
    if (!exit) {
      let finish = () => {};
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      exit = { finished, finish };
      exits.set(id, exit);
    }
    return exit;
  };
  // Each attachment's exit animation finishes when the test says so.
  vi.spyOn(Element.prototype, "getAnimations").mockImplementation(function (this: Element) {
    const id = this instanceof HTMLElement ? this.dataset.composerAttachment : undefined;
    return id === undefined ? [] : [{ finished: exitOf(id).finished, effect: null } as never];
  });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<Tray initial={initial} />));
  const buttons = () => [...container.querySelectorAll("button")];
  const shown = () =>
    buttons().map((button) => [
      button.textContent,
      button.getAttribute("data-ending-style") === "" && button.inert ? "exiting" : "shown",
    ]);
  const remove = (id: string) =>
    act(async () =>
      buttons()
        .find((button) => button.textContent === id)!
        .click(),
    );
  const draft = () => container.querySelector("div")!.dataset.draft;
  const finishExit = (id: string) => act(async () => exitOf(id).finish());
  return { draft, shown, remove, finishExit };
}

it("takes a removed attachment out of the draft at once and plays its exit in place", async () => {
  const tray = await mountTray(["a", "b", "c"]);

  await tray.remove("b");
  expect(tray.draft()).toBe("a c");
  expect(tray.shown()).toEqual([
    ["a", "shown"],
    ["b", "exiting"],
    ["c", "shown"],
  ]);

  await tray.finishExit("b");
  expect(tray.shown()).toEqual([
    ["a", "shown"],
    ["c", "shown"],
  ]);
});

it("keeps overlapping exits in their places", async () => {
  const tray = await mountTray(["a", "b", "c", "d"]);

  await tray.remove("c");
  await tray.remove("b");
  expect(tray.draft()).toBe("a d");
  expect(tray.shown()).toEqual([
    ["a", "shown"],
    ["b", "exiting"],
    ["c", "exiting"],
    ["d", "shown"],
  ]);

  await tray.finishExit("b");
  expect(tray.shown()).toEqual([
    ["a", "shown"],
    ["c", "exiting"],
    ["d", "shown"],
  ]);
});
