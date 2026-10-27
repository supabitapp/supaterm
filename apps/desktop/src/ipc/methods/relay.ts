import { RelayServerUrl } from "@supaterm/contracts";
import { MAX_DIRECT_TUNNEL_URLS } from "@supaterm/shared/relay/tunnel";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DesktopRelayGateway } from "../../relay/DesktopRelayGateway.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../channels.ts";

export const startRelay = DesktopIpc.makeIpcMethod({
  channel: Channels.START_RELAY_CHANNEL,
  payload: Schema.Struct({
    address: Schema.String,
    relayUrl: RelayServerUrl,
    directUrls: Schema.optionalKey(
      Schema.Array(RelayServerUrl).check(Schema.isMaxLength(MAX_DIRECT_TUNNEL_URLS)),
    ),
  }),
  result: Schema.String,
  handler: Effect.fn("desktop.ipc.relay.start")(function* ({ address, relayUrl, directUrls }) {
    return yield* (yield* DesktopRelayGateway).start(address, relayUrl, directUrls);
  }),
});
export const getRelayVia = DesktopIpc.makeIpcMethod({
  channel: Channels.GET_RELAY_VIA_CHANNEL,
  payload: Schema.String,
  result: Schema.NullOr(Schema.Literals(["relay", "direct"])),
  handler: Effect.fn("desktop.ipc.relay.via")(function* (address) {
    return yield* (yield* DesktopRelayGateway).via(address);
  }),
});
export const stopRelay = DesktopIpc.makeIpcMethod({
  channel: Channels.STOP_RELAY_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.relay.stop")(function* (address) {
    yield* (yield* DesktopRelayGateway).stop(address);
  }),
});
