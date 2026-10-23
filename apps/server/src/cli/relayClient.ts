// @effect-diagnostics nodeBuiltinImport:off - supplies the client companion listener.
import * as NodeHttp from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CliError, Command, Flag } from "effect/cli";
import { HttpRouter } from "effect/http";
import * as ServerConfig from "../config.ts";
import * as RelayCompanion from "../relay/RelayCompanion.ts";
import * as RelayCompanionHttp from "../relay/RelayCompanionHttp.ts";

export const relayClientCommand = Command.make("relay-client", {
  port: Flag.Int("port").pipe(Flag.withDefault(5741)),
}).pipe(
  Command.withDescription("Open the browser client with an encrypted relay companion."),
  Command.withHandler(
    Effect.fn("relayClient.run")(function* ({ port }) {
      if (port < 1 || port > 65535)
        return yield* new CliError.UserError({ cause: "Choose a port from 1 to 65535." });
      const staticDir = yield* ServerConfig.resolveStaticDir();
      if (!staticDir)
        return yield* new CliError.UserError({
          cause: "The browser client is missing. Build apps/web before running relay-client.",
        });
      const app = HttpRouter.serve(RelayCompanionHttp.layer(staticDir), {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(
        Layer.provide(RelayCompanion.layer()),
        Layer.provide(
          NodeHttpServer.layer(() => NodeHttp.createServer(), {
            port,
            host: "127.0.0.1",
            websocket: { maxPayload: 4096 },
          }),
        ),
      );
      yield* Layer.build(app);
      yield* Console.log(`Open http://127.0.0.1:${port} and add your relay pairing link.`);
      return yield* Effect.never;
    }),
  ),
);
