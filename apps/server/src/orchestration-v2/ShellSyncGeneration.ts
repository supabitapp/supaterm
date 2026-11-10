import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * Minted once per server run. A client resumes its in-memory shell on a new
 * connection only within one generation, so a restart forces a full snapshot.
 */
export class ShellSyncGeneration extends Context.Service<
  ShellSyncGeneration,
  { readonly id: string }
>()("supaterm/orchestration-v2/ShellSyncGeneration") {}

export const layer = Layer.effect(
  ShellSyncGeneration,
  Effect.gen(function* () {
    const random = yield* SecureRandom.SecureRandom;
    return ShellSyncGeneration.of({ id: yield* random.uuidV4() });
  }),
);
