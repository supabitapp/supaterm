import * as RelayGateway from "@supaterm/client-runtime/relay";
import { canonicalRelayAddress } from "@supaterm/shared/relay/protocol";
import { directTunnelUrls } from "@supaterm/shared/relay/tunnel";

export const layer = RelayGateway.layer({
  fetch: (input, init) => globalThis.fetch(input, init),
  open: async (address, relayUrl, directUrls, report) => {
    const { default: NativeRelay } = await import("../../modules/supaterm-relay-tunnel");
    const identity = canonicalRelayAddress(address);
    let via: RelayGateway.RelayTransport | undefined;
    const subscription = NativeRelay.addListener("onStatus", (status) => {
      if (canonicalRelayAddress(status.hostAddress) !== identity || status.via === via) return;
      via = status.via;
      report(via);
    });
    return {
      prepare: async () =>
        (
          await NativeRelay.start({
            hostAddress: address,
            relayUrl,
            directUrls: directTunnelUrls(directUrls(), relayUrl),
          })
        ).origin,
      close: async () => {
        subscription.remove();
        await NativeRelay.stop(address);
      },
    };
  },
});
