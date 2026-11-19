import { Persistence } from "@supaterm/client-runtime/platform";
import { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { vi } from "vite-plus/test";

vi.mock("../state/thread-outbox-removal", () => ({ clearThreadOutboxEnvironment: vi.fn() }));
vi.mock("../state/use-composer-drafts", () => ({ clearComposerDraftsEnvironment: vi.fn() }));
vi.mock("../state/thread-composer-error", () => ({
  clearThreadComposerErrorsForEnvironment: vi.fn(),
}));

import * as EnvironmentOwnedDataCleanup from "./environment-owned-data-cleanup";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

describe("EnvironmentOwnedDataCleanup", () => {
  it.effect("waits for the other clears and logs a bounded warning when one rejects", () => {
    const warnings: Array<unknown> = [];
    let releaseDrafts = () => {};
    let draftsCleared = false;
    const logger = Logger.make(({ message }) => {
      warnings.push(message);
      releaseDrafts();
    });
    const cleanupLayer = Layer.succeed(
      Persistence.EnvironmentOwnedDataCleanup,
      EnvironmentOwnedDataCleanup.make({
        outbox: () => Promise.reject(new Error("Some queued messages could not be read.")),
        drafts: () =>
          new Promise<void>((resolve) => {
            releaseDrafts = resolve;
          }).then(() => {
            draftsCleared = true;
          }),
        composerErrors: () => {},
      }),
    );
    return Effect.gen(function* () {
      const cleanup = yield* Persistence.EnvironmentOwnedDataCleanup;
      yield* cleanup.clear(ENVIRONMENT_ID);

      expect(draftsCleared).toBe(true);
      expect(warnings).toEqual([
        [
          "Could not clear mobile environment-owned data.",
          {
            environmentId: ENVIRONMENT_ID,
            operation: "outbox",
            errorType: "error",
            errorName: "Error",
            stack: expect.any(String),
          },
        ],
      ]);
    }).pipe(
      Effect.provide(
        Layer.merge(cleanupLayer, Logger.layer([logger], { mergeWithExisting: false })),
      ),
    );
  });
});
