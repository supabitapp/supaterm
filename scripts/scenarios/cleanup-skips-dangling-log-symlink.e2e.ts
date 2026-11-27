import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { SCENARIO_HOME } from "../e2e.config.ts";
import { runPromise, test, WEB } from "./supaterm.ts";

const decodeSettings = Schema.decodeSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

test(
  "Cleanup removes expired rotated logs even with a dangling symlink in the log directory",
  WEB,
  async ({ supaterm, app, browser, screen }) => {
    await supaterm.project("rotated-log-cleanup");
    const settingsPath = `${SCENARIO_HOME}/userdata/settings.json`;
    const logFixture = `${SCENARIO_HOME}/userdata/logs/00-cleanup-fixture`;
    const expiredLog = `${logFixture}/server.log.1`;
    const original = await runPromise(
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(settingsPath)),
    );

    try {
      await runPromise(
        Effect.flatMap(FileSystem.FileSystem, (fs) =>
          fs.writeFileString(
            settingsPath,
            JSON.stringify({ ...decodeSettings(original), storageCleanup: { logsAfterDays: 7 } }),
          ),
        ),
      );
      await supaterm.open("/settings/maintenance");
      await screen.getByLabel("Delete old rotated logs in days").waitFor();

      const deleteNow = async () => {
        await screen.getByRole("button", "Delete now", { exact: true }).tap();
        // A confirm pressed within 250 ms of arming is ignored as a double click.
        await runPromise(Effect.sleep("300 millis"));
        await screen.getByRole("button", "Confirm delete", { exact: true }).tap();
      };
      await deleteNow();
      await screen.getByRole("button", "Deleting…", { exact: true }).waitFor({ state: "hidden" });
      await screen.getByRole("button", /^Last run/).tap();
      const logsResult = browser
        .locator('#storage-cleanup-last-run [data-slot="settings-row"]')
        .filter({ has: screen.getByText("Rotated logs", { exact: true }) });
      await logsResult.getByText("No expired files", { exact: true }).waitFor();

      await runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.makeDirectory(logFixture);
          yield* fs.symlink(`${logFixture}/missing.log`, `${logFixture}/00-dangling.log.1`);
          yield* fs.writeFileString(expiredLog, "Expired log");
          yield* fs.utimes(expiredLog, 1, 1);
        }),
      );

      await deleteNow();
      await logsResult.scrollIntoView();
      try {
        await expect(logsResult).toContainText("Removed 1 rotated logs");
      } finally {
        await app.screenshot("rotated-log-cleanup-result");
      }
    } finally {
      await runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.remove(logFixture, { recursive: true, force: true });
          yield* fs.writeFileString(settingsPath, original);
        }),
      );
    }
  },
);
