import { PeerPairingCodeError } from "@supaterm/client-runtime/state/peerPairingCode";
import { DEFAULT_SERVER_SETTINGS, PeerLinkError } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentPresentation } from "../../state/environments";
import { linkCapableEnvironments, linkFailureMessage } from "./linkedEnvironments";

function environment(input: {
  readonly id: string;
  readonly phase: EnvironmentPresentation["connection"]["phase"];
  readonly peerLinks?: boolean;
  readonly enabled?: boolean;
  readonly config?: false;
}): EnvironmentPresentation {
  return {
    environmentId: input.id,
    connection: { phase: input.phase },
    serverConfig:
      input.config === false
        ? null
        : {
            settings: {
              ...DEFAULT_SERVER_SETTINGS,
              linkedEnvironmentsEnabled: input.enabled === true,
            },
            environment: {
              capabilities: input.peerLinks === undefined ? {} : { peerLinks: input.peerLinks },
            },
          },
  } as EnvironmentPresentation;
}

describe("linkCapableEnvironments", () => {
  it("keeps connected machines that advertise links, whether the setting is on or off", () => {
    const hosts = linkCapableEnvironments([
      environment({ id: "off", phase: "connected", peerLinks: true }),
      environment({ id: "on", phase: "connected", peerLinks: true, enabled: true }),
      environment({ id: "older-server", phase: "connected", enabled: true }),
      environment({ id: "declines", phase: "connected", peerLinks: false, enabled: true }),
      environment({ id: "reconnecting", phase: "reconnecting", peerLinks: true, enabled: true }),
      environment({ id: "no-config", phase: "connected", config: false }),
    ]);

    expect(hosts.map((host) => host.environmentId)).toEqual(["off", "on"]);
  });
});

describe("linkFailureMessage", () => {
  it("passes on what a link error or a refused pairing code says", () => {
    expect(
      linkFailureMessage(
        new PeerLinkError({ reason: "pairing_rejected", message: "That code was already used." }),
      ),
    ).toBe("That code was already used.");
    expect(
      linkFailureMessage(new PeerPairingCodeError({ reason: "not_allowed", cause: null })),
    ).toBe("Your session there cannot create pairing codes. Paste a code from there instead.");
  });

  it("never echoes a failure that could carry the request", () => {
    expect(linkFailureMessage(new Error('Invalid payload {"pairingCode":"code-1"}'))).toBe(
      "Could not link the environment. Try again.",
    );
  });
});
