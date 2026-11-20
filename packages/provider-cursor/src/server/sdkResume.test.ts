// @effect-diagnostics nodeBuiltinImport:off -- The test reads the SDK's own protobuf runtime from disk.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodeModule from "node:module";
import { vi } from "vite-plus/test";

import { loadCursorSdk } from "./sdk.ts";
import { resumeCursorRun } from "./sdkResume.ts";

interface ConversationAction {
  getType(): {
    readonly typeName: string;
    fromBinary(bytes: Uint8Array): ConversationAction;
  };
  toBinary(): Uint8Array;
  readonly action?: { readonly case?: string };
}

interface ProtobufUtil {
  initPartial: (source: unknown, target: ConversationAction) => void;
}

describe("resumeCursorRun", () => {
  it.effect("sends Cursor's ResumeAction where a message would go, and leaves messages alone", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-resume-" });
      // Nothing reaches Cursor: its key exchange and model list answer here, and the run is refused.
      vi.stubEnv("CURSOR_BACKEND_URL", "http://127.0.0.1:9");
      vi.stubGlobal("fetch", async (url: string) => {
        const { pathname } = new URL(url);
        if (pathname === "/auth/exchange_user_api_key") return Response.json({ accessToken: "t" });
        if (pathname === "/v1/models") return Response.json({ items: [{ id: "composer-1" }] });
        return new Response(null, { status: 404 });
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          vi.unstubAllEnvs();
          vi.unstubAllGlobals();
        }),
      );

      const sdk = loadCursorSdk();
      const util: ProtobufUtil = NodeModule.createRequire(
        NodeModule.createRequire(import.meta.url).resolve("@cursor/sdk"),
      )("@bufbuild/protobuf").proto3.util;
      const initPartial = util.initPartial;
      const builtActions: Array<ConversationAction> = [];
      util.initPartial = (source, target) => {
        initPartial.call(util, source, target);
        if (target.getType().typeName === "agent.v1.ConversationAction") {
          builtActions.push(target);
        }
      };
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          util.initPartial = initPartial;
        }),
      );

      const model = { id: "composer-1" };
      const agent = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          sdk.Agent.create({
            apiKey: "key_test",
            model,
            local: {
              cwd: workspace,
              store: new sdk.JsonlLocalAgentStore(workspace),
              sandboxOptions: { enabled: false },
            },
          }),
        ),
      );
      const stop = (run: Awaited<ReturnType<typeof agent.send>>) =>
        Effect.promise(async () => {
          await run.cancel();
          await run.wait();
        });

      yield* stop(yield* Effect.promise(() => agent.send("Write a story.", { model })));
      yield* stop(yield* Effect.promise(() => resumeCursorRun(agent, { model })));
      yield* stop(yield* Effect.promise(() => agent.send("", { model })));

      const sentActions = builtActions.map(
        (action) => action.getType().fromBinary(action.toBinary()).action?.case,
      );
      assert.deepStrictEqual(sentActions, [
        "userMessageAction",
        "resumeAction",
        "userMessageAction",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
