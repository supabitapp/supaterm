import { ANOTHER_ADDRESS, type LinkableMachine } from "@supaterm/client-runtime/link-request";
import { PeerPairingCodeError } from "@supaterm/client-runtime/state/peerPairingCode";
import { DEFAULT_SERVER_SETTINGS, type EnvironmentId, PeerLinkError } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentPresentation } from "../../state/environments";
import {
  linkCapableEnvironments,
  linkFailureMessage,
  linkTarget,
  peerLinkCreateInput,
} from "./linkedEnvironments";

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

const machine = (id: string, urls: ReadonlyArray<string>): LinkableMachine => ({
  environmentId: id as EnvironmentId,
  label: id.toUpperCase(),
  machine: "server",
  connected: true,
  linked: false,
  urls,
});
const vps = machine("vps", ["https://vps.tailnet.ts.net", "http://100.64.0.2:3773"]);
const relayOnly = machine("laptop", []);

describe("linkTarget", () => {
  it.each([
    { name: "nothing until a machine is picked", choice: null, expected: { kind: "none" } },
    {
      name: "a machine by this app's addresses",
      choice: "vps",
      expected: { kind: "machine", machine: vps },
    },
    {
      name: "a typed address for a machine reached only over the relay",
      choice: "laptop",
      expected: { kind: "address", machine: relayOnly },
    },
    {
      name: "a typed address for another address",
      choice: ANOTHER_ADDRESS,
      expected: { kind: "address", machine: null },
    },
    {
      name: "a typed address for a machine that left the list",
      choice: "gone",
      expected: { kind: "address", machine: null },
    },
  ])("links $name", ({ choice, expected }) => {
    expect(linkTarget([vps, relayOnly], choice)).toEqual(expected);
  });

  it("leaves only a typed address when the app knows no other machine", () => {
    expect(linkTarget([], null)).toEqual({ kind: "address", machine: null });
  });
});

describe("peerLinkCreateInput", () => {
  const link = (
    input: Partial<Parameters<typeof peerLinkCreateInput>[0]> &
      Pick<Parameters<typeof peerLinkCreateInput>[0], "target">,
  ) => peerLinkCreateInput({ address: "", access: "auto", pairingCode: "code-1", ...input });

  it("links one of the app's machines by every address it has and names the machine", () => {
    expect(link({ target: { kind: "machine", machine: vps }, pairingCode: " code-1 " })).toEqual({
      url: "https://vps.tailnet.ts.net",
      alternateUrls: ["http://100.64.0.2:3773"],
      expectedEnvironmentId: "vps",
      expectedLabel: "VPS",
      pairingCode: "code-1",
      access: "auto",
    });
  });

  it("leaves alternates out for a machine with one address", () => {
    const target = linkTarget([machine("vps", ["https://vps.tailnet.ts.net"])], "vps");

    expect(link({ target })).toEqual({
      url: "https://vps.tailnet.ts.net",
      expectedEnvironmentId: "vps",
      expectedLabel: "VPS",
      pairingCode: "code-1",
      access: "auto",
    });
  });

  it.each([
    { name: "a relay-only machine", target: { kind: "address", machine: relayOnly } as const },
    { name: "another address", target: { kind: "address", machine: null } as const },
  ])("links the typed address alone for $name, naming no machine", ({ target }) => {
    expect(link({ target, address: " https://box.example.com " })).toEqual({
      url: "https://box.example.com",
      pairingCode: "code-1",
      access: "auto",
    });
  });

  it.each([
    { name: "no target", input: { target: { kind: "none" } as const } },
    {
      name: "a blank code",
      input: { target: { kind: "machine", machine: vps } as const, pairingCode: "  " },
    },
    {
      name: "a blank address",
      input: { target: { kind: "address", machine: null } as const, address: " " },
    },
  ])("builds nothing for $name", ({ input }) => {
    expect(link(input)).toBeNull();
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
