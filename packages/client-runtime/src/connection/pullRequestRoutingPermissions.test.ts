import { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { BearerConnectionProfile, type ConnectionCatalogEntry } from "./catalog.ts";
import { BearerConnectionTarget } from "./model.ts";
import {
  pullRequestRoutingConnectionKey,
  pullRequestRoutingPermissionFor,
  makePullRequestRoutingPermissions,
  type StoredPullRequestRoutingPermission,
} from "./pullRequestRoutingPermissions.ts";
import { entryWithRoutes, mergeLearnedRoutes } from "./routes.ts";

const environmentId = EnvironmentId.make("route-trust-test");
function savedRoute(url: string): ConnectionCatalogEntry {
  const connectionId = `paired:${url}`;
  return {
    target: new BearerConnectionTarget({ environmentId, connectionId, label: "Remote" }),
    profile: Option.some(
      new BearerConnectionProfile({
        environmentId,
        connectionId,
        label: "Remote",
        httpBaseUrl: url,
        wsBaseUrl: url.replace(/^http/, "ws"),
      }),
    ),
    enabled: true,
  };
}
const lan = savedRoute("http://192.168.1.20:4389");
const tailnet = savedRoute("https://remote.example.ts.net");
const grant = (entry: ConnectionCatalogEntry) => [
  {
    environmentId,
    connectionKey: pullRequestRoutingConnectionKey(entry)!,
    permission: "read-write" as const,
  },
];

describe("Pull request routing trust across routes", () => {
  it("preserves a grant when the same saved addresses are reordered", () => {
    const entry = entryWithRoutes(lan, [lan, tailnet]);
    expect(
      pullRequestRoutingPermissionFor(entryWithRoutes(entry, [tailnet, lan]), grant(entry)),
    ).toBe("read-write");
  });
  it("keeps a grant saved while the relay host still used its legacy address", () => {
    const host = `${"ab".repeat(16)}.${"cd".repeat(16)}`;
    const relay = savedRoute(`https://${host}.relay.supaterm.alt/`);
    const legacy = savedRoute(`https://${host}.relay.supaterm.invalid/`);
    expect(pullRequestRoutingPermissionFor(relay, grant(legacy))).toBe("read-write");
    expect(
      pullRequestRoutingPermissionFor(
        entryWithRoutes(lan, [lan, relay]),
        grant(entryWithRoutes(lan, [lan, legacy])),
      ),
    ).toBe("read-write");
  });
  it("revokes a grant when an alternate address is added, changed, or removed", () => {
    const entry = entryWithRoutes(lan, [lan, tailnet]);
    const changed = entryWithRoutes(lan, [lan, savedRoute("https://other.example.test")]);
    expect(pullRequestRoutingPermissionFor(entry, grant(lan))).toBe("off");
    expect(pullRequestRoutingPermissionFor(changed, grant(entry))).toBe("off");
    expect(pullRequestRoutingPermissionFor(lan, grant(entry))).toBe("off");
  });
  it("retains a paired route's grant when learned LAN addresses change", () => {
    const learned = mergeLearnedRoutes({
      entry: lan,
      activeRoute: lan,
      reported: [{ httpBaseUrl: "http://192.168.1.21:4389" }],
      allowInsecure: true,
    })!;
    const entry = entryWithRoutes(lan, learned);
    expect(pullRequestRoutingPermissionFor(entry, grant(lan))).toBe("read-write");
    const changed = mergeLearnedRoutes({
      entry,
      activeRoute: lan,
      reported: [{ httpBaseUrl: "http://192.168.1.30:4389" }],
      allowInsecure: true,
    })!;
    expect(pullRequestRoutingPermissionFor(entryWithRoutes(entry, changed), grant(lan))).toBe(
      "read-write",
    );
  });
  it("does not trust a route list containing an invalid saved address", () => {
    const entry = entryWithRoutes(lan, [lan, savedRoute("https://name:password@example.test")]);
    expect(pullRequestRoutingConnectionKey(entry)).toBeNull();
    expect(pullRequestRoutingPermissionFor(entry, grant(lan))).toBe("off");
  });
  it.effect("reads existing endpoint grants and persists revocation", () =>
    Effect.gen(function* () {
      const stored = yield* Ref.make<ReadonlyArray<StoredPullRequestRoutingPermission>>(grant(lan));
      const service = yield* makePullRequestRoutingPermissions({
        read: Ref.get(stored),
        write: (permissions) => Ref.set(stored, permissions),
      });
      expect(yield* service.get(lan)).toBe("read-write");
      yield* service.forget(environmentId);
      expect(yield* service.get(lan)).toBe("off");
      expect(yield* Ref.get(stored)).toEqual([]);
    }),
  );
});
