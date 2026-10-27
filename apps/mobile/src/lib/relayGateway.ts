import * as RelayGateway from "@supaterm/client-runtime/relay";
import { canonicalRelayAddress } from "@supaterm/shared/relay/protocol";

export const layer = RelayGateway.layer({
  fetch: (input, init) => globalThis.fetch(input, init),
  open: async (address, relayUrl, directUrls) => {
    const { default: NativeRelay } = await import("../../modules/supaterm-relay-tunnel");
    const identity = canonicalRelayAddress(address);
    let via: RelayGateway.RelayTransport | undefined;
    const subscription = NativeRelay.addListener("onStatus", (status) => {
      if (canonicalRelayAddress(status.hostAddress) === identity) via = status.via;
    });
    return {
      prepare: async () =>
        (
          await NativeRelay.start({
            hostAddress: address,
            relayUrl,
            directUrls: [...directUrls()],
          })
        ).origin,
      via: () => via,
      close: async () => {
        subscription.remove();
        await NativeRelay.stop(address);
      },
    };
  },
});
