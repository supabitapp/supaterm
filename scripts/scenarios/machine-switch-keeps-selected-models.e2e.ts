import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { SCENARIO_HOME } from "../e2e.config.ts";
import { SECOND_HOME, startSecondServer } from "./second-server.ts";
import { run } from "./shell.ts";
import { makeState, runPromise, test, WEB } from "./supaterm.ts";

test(
  "A new draft keeps its selected models when it moves to another machine",
  WEB,
  async ({ supaterm, app, screen, browser }) => {
    const primary = makeState(SCENARIO_HOME);
    const second = makeState(SECOND_HOME);
    // Machines share a project through its repository, which needs a remote to be named by.
    const workspace = await runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(path.join(SCENARIO_HOME, "workspaces"), { recursive: true });
        const directory = yield* fs.makeTempDirectory({
          directory: path.join(SCENARIO_HOME, "workspaces"),
          prefix: "demo-",
        });
        yield* fs.writeFileString(path.join(directory, "README.md"), "");
        return directory;
      }),
    );
    const git = (args: ReadonlyArray<string>) => runPromise(run("git", args, { cwd: workspace }));
    await git(["init", "--quiet", "--initial-branch=main"]);
    await git(["remote", "add", "origin", "https://github.com/scenario/demo.git"]);
    await git(["add", "--all"]);
    await git([
      "-c",
      "user.name=Scenario",
      "-c",
      "user.email=scenario@example.invalid",
      "commit",
      "--quiet",
      "--message",
      "Initial commit",
    ]);
    await runPromise(primary.cli(["project", "add", workspace, "--title", "demo"]));
    const server = startSecondServer(app.baseUrl ?? "");
    try {
      const { host, token } = await server.ready;
      await runPromise(second.cli(["project", "add", workspace, "--title", "demo"]));

      await supaterm.open("/settings/connections");
      await screen.getByRole("button", "Add environment").tap();
      const dialog = screen.getByRole("dialog");
      await dialog.getByRole("textbox", "Host", { exact: true }).fill(host);
      await dialog.getByPlaceholder("PAIRCODE").fill(token);
      await dialog.getByRole("button", "Add environment").tap();
      // Setup, so waitFor: a proof reads only a failed expectation as the bug.
      await screen.getByRole("button", "More actions for Scenario").waitFor({ timeout: 60_000 });
      await app.open("/");
      // Shift adds a model to the draft instead of replacing it.
      await screen.getByRole("button", "Showcase", { exact: false }).first().tap();
      await browser.keyboard.type("Plan and reads");
      await browser.keyboard.press("Shift+Enter");
      await browser.keyboard.press("Escape");
      const models = screen.getByRole("button", "Showcase, Plan and reads", { exact: false });
      await expect(models.first()).toBeVisible();

      // Both machines are named Scenario; the draft runs on the selected one.
      const runOn = () => screen.getByRole("combobox", "Run on", { exact: true }).tap();
      const machine = (index: number) =>
        screen.getByRole("option", "Scenario", { exact: true }).nth(index);
      await runOn();
      const target = (await machine(0).getAttribute("aria-selected")) === "true" ? 1 : 0;
      await machine(target).tap();
      await runOn();
      await expect(machine(target)).toHaveAttribute("aria-selected", "true");
      await browser.keyboard.press("Escape");

      await app.screenshot("after-machine-switch");
      await expect(models.first()).toBeVisible();
    } finally {
      await server.stop();
      await runPromise(primary.cli(["project", "remove", workspace, "--force"]));
    }
  },
);
