/// <reference lib="dom" />
// The DOM lib types the function this scenario runs in the page.
import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { SCENARIO_HOME } from "../e2e.config.ts";
import { runPromise, test, WEB } from "./supaterm.ts";

const EDITOR_ARGS = `${SCENARIO_HOME}/editor-args.txt`;

/** The file's lines, or none while it does not exist. */
const readLines = (file: string) =>
  runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      if (!(yield* fs.exists(file))) return [];
      return (yield* fs.readFileString(file)).trim().split("\n");
    }),
  );

test(
  "Ctrl+click on a GNU ls --hyperlink filename, whose file URI names this machine, opens that file",
  WEB,
  async ({ supaterm, app, browser, screen }) => {
    await runPromise(
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(EDITOR_ARGS, { force: true })),
    );
    const project = await supaterm.project("demo", { "one.txt": "hello\n" });
    const thread = await supaterm.thread({ project, title: "List", messages: ["List it"] });
    await supaterm.open(thread);

    await screen.getByRole("button", "Toggle terminal drawer").tap();
    const input = screen.getByRole("textbox", "Terminal input");
    // The input mounts before fonts and WASM finish loading and its handlers are installed.
    await expect(input).toHaveAttribute("data-workspace-focus-default", "");
    await input.focus();
    // What GNU ls --hyperlink writes, `file://<hostname>/<path>`, by printf, which every platform has.
    // Enough rows to scroll, so every row is the link.
    await browser.keyboard.type(
      'for i in $(seq 1 100); do printf \'\\033]8;;file://%s%s\\033\\\\one.txt\\033]8;;\\033\\\\\\n\' "$(hostname)" "$PWD/one.txt"; done; touch ls.done\n',
    );
    await expect.poll(() => readLines(`${project}/ls.done`), { timeout: 30_000 }).toEqual([""]);
    await browser.setViewport({ width: 1000, height: 700 });
    await app.screenshot("listed-and-resized");

    // The terminal draws on a canvas, so point at the first cells of its middle row.
    const canvas = await browser.evaluate(() => {
      const box = document
        .querySelector('[aria-label="Terminal input"]')
        ?.parentElement?.querySelector("canvas")
        ?.getBoundingClientRect();
      return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
    });
    if (!canvas) throw new Error("The terminal canvas is not on the page.");
    await browser.mouse.move(canvas.x + 16, canvas.y + canvas.height / 2);
    await browser.keyboard.down("ControlOrMeta");
    await browser.mouse.down();
    await browser.mouse.up();
    await browser.keyboard.up("ControlOrMeta");
    await app.screenshot("after-ctrl-click");

    await expect
      .poll(() => readLines(EDITOR_ARGS), { timeout: 15_000 })
      .toEqual(["--classic", `${project}/one.txt`]);
  },
);
