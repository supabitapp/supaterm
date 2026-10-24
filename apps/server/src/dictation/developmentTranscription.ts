import type { ProviderTranscription } from "@supaterm/provider-core/server/transcription";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

import { ServerConfig } from "../config.ts";

export const withDevelopmentTranscription = Effect.fnUntraced(function* (
  transcription: ProviderTranscription,
) {
  const config = yield* ServerConfig;
  if (config.devUrl === undefined) return transcription;
  const text = yield* Config.String("SUPATERM_DEV_DICTATION_TEXT").pipe(
    Config.withDefault(""),
    Effect.orDie,
  );
  if (text.length === 0) return transcription;
  return {
    kind: transcription.kind,
    describe: Effect.succeed({
      serviceLabel: "Development fixture",
      accountLabel: null,
      eligible: true,
      audioFormats: ["webm", "wav", "mp4", "m4a", "ogg"],
    }),
    transcribe: () => Effect.sleep("3 seconds").pipe(Effect.as({ text })),
  } satisfies ProviderTranscription;
});
