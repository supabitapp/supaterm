import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import type { ProviderTranscription } from "@supaterm/provider-core/server/transcription";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import { withDevelopmentTranscription } from "./developmentTranscription.ts";

it.effect("requires a development server and an explicit fixture to replace transcription", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const original: ProviderTranscription = {
      kind: "codex",
      describe: Effect.succeed(null),
      transcribe: () => Effect.succeed({ text: "actual provider" }),
    };
    for (const devUrl of [undefined, new URL("http://localhost:5173")]) {
      for (const text of ["", "fixture"]) {
        const selected = yield* withDevelopmentTranscription(original).pipe(
          Effect.provideService(ServerConfig, { ...config, devUrl }),
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({ env: { SUPATERM_DEV_DICTATION_TEXT: text } }),
            ),
          ),
        );
        if (devUrl && text)
          expect((yield* selected.describe)?.serviceLabel).toBe("Development fixture");
        else expect(selected).toBe(original);
      }
    }
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "dictation-fixture-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Effect.scoped,
  ),
);
