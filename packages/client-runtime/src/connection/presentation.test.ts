import { DEFAULT_PUBLIC_RELAY_URL, EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import {
  BearerConnectionTarget,
  ConnectionTransientError,
  type SupervisorConnectionState,
} from "./model.ts";
import {
  connectionCatalogDisplayUrl,
  environmentConnectionAddress,
  environmentMcpUrl,
  presentEnvironmentConnection,
  presentConnectionState,
} from "./presentation.ts";

const TARGET = new BearerConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Remote environment",
  connectionId: "connection-1",
});

const ENTRY: ConnectionCatalogEntry = {
  target: TARGET,
  profile: Option.some(
    new BearerConnectionProfile({
      connectionId: TARGET.connectionId,
      environmentId: TARGET.environmentId,
      label: TARGET.label,
      httpBaseUrl: "https://environment.example.test",
      wsBaseUrl: "wss://environment.example.test",
    }),
  ),
  enabled: true,
};

function supervisorState(overrides: Partial<SupervisorConnectionState>): SupervisorConnectionState {
  return {
    desired: true,
    network: "online",
    phase: "connecting",
    stage: "preparing",
    attempt: 1,
    generation: 0,
    lastFailure: null,
    retryAt: null,
    ...overrides,
  };
}

describe("connection presentation", () => {
  const lan: ConnectionRoute = {
    target: TARGET,
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId: TARGET.connectionId,
        environmentId: TARGET.environmentId,
        label: TARGET.label,
        httpBaseUrl: "http://192.168.4.53:7373/",
        wsBaseUrl: "ws://192.168.4.53:7373/",
      }),
    ),
  };
  const relayTarget = new BearerConnectionTarget({ ...TARGET, connectionId: "relay" });
  const relay: ConnectionRoute = {
    target: relayTarget,
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId: relayTarget.connectionId,
        environmentId: TARGET.environmentId,
        label: TARGET.label,
        httpBaseUrl: `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`,
        wsBaseUrl: `wss://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`,
      }),
    ),
  };
  const routedEntry: ConnectionCatalogEntry = { ...lan, enabled: true, alternateRoutes: [relay] };

  it("shows the active fallback route without changing the saved address", () => {
    expect(
      environmentConnectionAddress({
        entry: routedEntry,
        connectionState: "connected",
        connectedTarget: relayTarget,
      }),
    ).toBe(`Encrypted Relay · ${DEFAULT_PUBLIC_RELAY_URL}`);
    expect(
      environmentConnectionAddress({
        entry: routedEntry,
        connectionState: "connected",
        connectedTarget: TARGET,
      }),
    ).toBe("LAN · http://192.168.4.53:7373/");
    expect(connectionCatalogDisplayUrl(routedEntry)).toBe("http://192.168.4.53:7373/");
  });

  it("uses the custom relay server address instead of the host identity", () => {
    const profile = Option.getOrThrow(relay.profile);
    if (profile._tag !== "BearerConnectionProfile") throw new Error("Expected bearer profile");
    expect(
      environmentConnectionAddress({
        entry: {
          ...routedEntry,
          alternateRoutes: [
            {
              ...relay,
              profile: Option.some(
                new BearerConnectionProfile({
                  ...profile,
                  relayUrl: "wss://custom-relay.example.test/relay",
                }),
              ),
            },
          ],
        },
        connectionState: "connected",
        connectedTarget: relayTarget,
      }),
    ).toBe("Encrypted Relay · wss://custom-relay.example.test/relay");
  });

  it.each(["available", "offline", "connecting", "reconnecting", "error", "unsupported"] as const)(
    "keeps the saved address while %s instead of claiming a route is active",
    (connectionState) => {
      expect(
        environmentConnectionAddress({
          entry: routedEntry,
          connectionState,
          connectedTarget: relayTarget,
        }),
      ).toBe("http://192.168.4.53:7373/");
    },
  );

  it("keeps the saved address when disabled or the active route is unavailable", () => {
    expect(
      environmentConnectionAddress({
        entry: { ...routedEntry, enabled: false },
        connectionState: "connected",
        connectedTarget: relayTarget,
      }),
    ).toBe("http://192.168.4.53:7373/");
    expect(
      environmentConnectionAddress({
        entry: routedEntry,
        connectionState: "connected",
      }),
    ).toBe("http://192.168.4.53:7373/");
    expect(
      environmentConnectionAddress({
        entry: routedEntry,
        connectionState: "connected",
        connectedTarget: new BearerConnectionTarget({ ...TARGET, connectionId: "removed" }),
      }),
    ).toBe("http://192.168.4.53:7373/");
  });

  it("copies the MCP address of the route this device is connected over", () => {
    const route = (connectionId: string, httpBaseUrl: string): ConnectionRoute => {
      const target = new BearerConnectionTarget({ ...TARGET, connectionId });
      return {
        target,
        profile: Option.some(
          new BearerConnectionProfile({
            connectionId,
            environmentId: TARGET.environmentId,
            label: TARGET.label,
            httpBaseUrl,
            wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
          }),
        ),
      };
    };
    const lan = route("lan", "http://192.168.4.53:3773/");
    const tailnet = route("tailnet", "http://100.115.1.44:3773/");
    const serve = route("serve", "https://machine.tailnet.ts.net/");
    const entry: ConnectionCatalogEntry = {
      ...ENTRY,
      target: lan.target,
      profile: lan.profile,
      alternateRoutes: [tailnet, serve],
    };

    expect(environmentMcpUrl({ entry, connectedTarget: tailnet.target })).toBe(
      "http://100.115.1.44:3773/mcp",
    );

    expect(environmentMcpUrl({ entry })).toBe("http://192.168.4.53:3773/mcp");
  });

  it("passes over routes without an address of their own", () => {
    const relay = new BearerConnectionTarget({
      connectionId: "unresolved",
      environmentId: TARGET.environmentId,
      label: TARGET.label,
    });
    const entry: ConnectionCatalogEntry = {
      ...ENTRY,
      target: relay,
      profile: Option.none(),
      alternateRoutes: [{ target: ENTRY.target, profile: ENTRY.profile }],
    };

    expect(environmentMcpUrl({ entry, connectedTarget: relay })).toBe(
      "https://environment.example.test/mcp",
    );
  });

  it("distinguishes initial connection, reconnect, and retry errors", () => {
    expect(presentConnectionState(supervisorState({ phase: "connecting", attempt: 1 }))).toEqual({
      phase: "connecting",
      error: null,
      traceId: null,
    });
    expect(
      presentConnectionState(
        supervisorState({
          phase: "connecting",
          attempt: 2,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Socket closed.",
            traceId: "trace-previous",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      error: "Socket closed.",
      traceId: "trace-previous",
    });
    expect(
      presentConnectionState(
        supervisorState({
          phase: "backoff",
          attempt: 2,
          retryAt: 1,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Disconnected.",
            traceId: "trace-1",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      error: "Disconnected.",
      traceId: "trace-1",
    });
  });

  it("preserves an explicitly available environment while offline", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          desired: false,
          network: "offline",
          phase: "available",
          stage: null,
          attempt: 0,
        }),
      ),
    ).toEqual({
      phase: "available",
      error: null,
      traceId: null,
    });
  });
});
