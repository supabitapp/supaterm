import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, type ServerConfig } from "@supaterm/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import { AVAILABLE_CONNECTION_STATE, PrimaryConnectionTarget } from "../connection/model.ts";
import { isEnvironmentConnected } from "../connection/presentation.ts";
import {
  createEnvironmentPresentationAtoms,
  createEnvironmentSummaryAtoms,
} from "./presentation.ts";
import type { EnvironmentCatalogState } from "./connections.ts";

const FIRST = EnvironmentId.make("first");
const SECOND = EnvironmentId.make("second");
function entry(environmentId: EnvironmentId, label = environmentId as string) {
  return {
    target: new PrimaryConnectionTarget({
      environmentId,
      label,
      httpBaseUrl: "https://example.test",
      wsBaseUrl: "wss://example.test",
    }),
    enabled: true,
    profile: Option.none(),
  };
}
function config(cwd = "/workspace"): ServerConfig {
  return {
    cwd,
    environment: { capabilities: {}, platform: { machine: "desktop" } },
  } as ServerConfig;
}
function harness() {
  const catalog = Atom.make<EnvironmentCatalogState>({
    isReady: true,
    entries: new Map([
      [FIRST, entry(FIRST)],
      [SECOND, entry(SECOND)],
    ]),
  });
  const configs = Atom.family((_id: EnvironmentId) => Atom.make<ServerConfig | null>(config()));
  const state = Atom.make(AsyncResult.success(AVAILABLE_CONNECTION_STATE));
  const full = createEnvironmentPresentationAtoms({
    catalogValueAtom: catalog,
    stateAtom: () => state,
    serverConfigValueAtom: configs,
  });
  const summaries = createEnvironmentSummaryAtoms({
    catalogValueAtom: catalog,
    presentationAtom: full.presentationAtom,
  });
  return { catalog, configs, state, full, ...summaries, registry: AtomRegistry.make() };
}

describe("environment summary subscriptions", () => {
  it("updates thread connection selectors only when their own environment connects or disconnects", () => {
    const h = harness();
    const states = Atom.family((_id: EnvironmentId) =>
      Atom.make(AsyncResult.success(AVAILABLE_CONNECTION_STATE)),
    );
    const presentations = createEnvironmentPresentationAtoms({
      catalogValueAtom: h.catalog,
      stateAtom: states,
      serverConfigValueAtom: h.configs,
    });
    const connected = Atom.family((id: EnvironmentId) =>
      Atom.map(presentations.presentationAtom(id), isEnvironmentConnected),
    );
    h.registry.get(connected(FIRST));
    h.registry.get(connected(SECOND));
    const changes = { first: 0, second: 0 };
    const stops = [
      h.registry.subscribe(connected(FIRST), () => changes.first++),
      h.registry.subscribe(connected(SECOND), () => changes.second++),
    ];
    try {
      expect(h.registry.get(connected(FIRST))).toBe(false);
      expect(h.registry.get(connected(SECOND))).toBe(false);
      h.registry.set(
        states(FIRST),
        AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, phase: "connecting" }),
      );
      h.registry.set(h.configs(FIRST), config("/updated-config"));
      expect(changes).toEqual({ first: 0, second: 0 });

      h.registry.set(
        states(FIRST),
        AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, phase: "connected", generation: 1 }),
      );
      expect(h.registry.get(connected(FIRST))).toBe(true);
      expect(h.registry.get(connected(SECOND))).toBe(false);
      expect(changes).toEqual({ first: 1, second: 0 });

      h.registry.set(
        states(FIRST),
        AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, phase: "backoff", attempt: 2 }),
      );
      expect(h.registry.get(connected(FIRST))).toBe(false);
      expect(changes).toEqual({ first: 2, second: 0 });
      h.registry.set(
        states(FIRST),
        AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, phase: "connecting", attempt: 2 }),
      );
      expect(changes).toEqual({ first: 2, second: 0 });

      h.registry.set(
        states(FIRST),
        AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, phase: "connected", generation: 2 }),
      );
      expect(h.registry.get(connected(FIRST))).toBe(true);
      expect(changes).toEqual({ first: 3, second: 0 });
      h.registry.set(h.catalog, { isReady: true, entries: new Map([[SECOND, entry(SECOND)]]) });
      expect(h.registry.get(connected(FIRST))).toBe(false);
      expect(changes).toEqual({ first: 4, second: 0 });
    } finally {
      stops.forEach((stop) => stop());
      h.registry.dispose();
    }
  });

  it("publishes full config updates without notifying membership, labels, connections or capability consumers", () => {
    const h = harness();
    h.registry.get(h.full.presentationsAtom);
    h.registry.get(h.environmentIdsAtom);
    h.registry.get(h.identitiesAtom);
    h.registry.get(h.environmentsAtom);
    h.registry.get(h.pullRequestsSupportedAtom);
    h.registry.get(h.machineByIdAtom);
    const counts = { full: 0, ids: 0, labels: 0, connections: 0, capability: 0, machines: 0 };
    const stops = [
      h.registry.subscribe(h.machineByIdAtom, () => counts.machines++),
      h.registry.subscribe(h.full.presentationsAtom, () => counts.full++),
      h.registry.subscribe(h.environmentIdsAtom, () => counts.ids++),
      h.registry.subscribe(h.identitiesAtom, () => counts.labels++),
      h.registry.subscribe(h.environmentsAtom, () => counts.connections++),
      h.registry.subscribe(h.pullRequestsSupportedAtom, () => counts.capability++),
    ];
    const initialIds = h.registry.get(h.environmentIdsAtom);
    const initialLabels = h.registry.get(h.identitiesAtom);
    try {
      for (let i = 0; i < 20; i++) {
        const next = config(`/workspace-${i}`);
        h.registry.set(h.configs(FIRST), next);
        expect(h.registry.get(h.full.presentationsAtom).get(FIRST)?.serverConfig?.cwd).toBe(
          next.cwd,
        );
        expect(h.registry.get(h.environmentIdsAtom)).toBe(initialIds);
        expect(h.registry.get(h.identitiesAtom)).toBe(initialLabels);
        h.registry.get(h.environmentsAtom);
        expect(h.registry.get(h.machineByIdAtom).get(FIRST)).toBe("desktop");
        expect(h.registry.get(h.pullRequestsSupportedAtom)).toBe(true);
      }
      expect(counts).toEqual({
        full: 20,
        ids: 0,
        labels: 0,
        connections: 0,
        capability: 0,
        machines: 0,
      });
      h.registry.set(h.catalog, {
        isReady: true,
        entries: new Map([
          [FIRST, entry(FIRST, "Renamed")],
          [SECOND, entry(SECOND)],
        ]),
      });
      expect(h.registry.get(h.identitiesAtom)[0]?.label).toBe("Renamed");
      expect(h.registry.get(h.environmentIdsAtom)).toBe(initialIds);
      expect(h.registry.get(h.environmentsAtom)[0]?.environmentLabel).toBe("Renamed");
      expect(counts.labels).toBe(1);
      expect(counts.ids).toBe(0);
    } finally {
      stops.forEach((stop) => stop());
      h.registry.dispose();
    }
  });

  it("keeps presentations identical when only provider statuses change", () => {
    const h = harness();
    const pushes = { presentations: 0, providers: 0, configs: 0 };
    const stops = [
      h.registry.subscribe(h.full.presentationsAtom, () => pushes.presentations++),
      h.registry.subscribe(h.full.providersByEnvironmentAtom, () => pushes.providers++),
      h.registry.subscribe(h.full.serverConfigsAtom, () => pushes.configs++),
    ];
    try {
      const base = config();
      h.registry.set(h.configs(FIRST), { ...base, providers: [] } as ServerConfig);
      const presentations = h.registry.get(h.full.presentationsAtom);
      const configs = h.registry.get(h.full.serverConfigsAtom);
      const before = { ...pushes };
      const providers = [{ instanceId: "codex" }] as unknown as ServerConfig["providers"];
      h.registry.set(h.configs(FIRST), { ...base, providers } as ServerConfig);

      expect(h.registry.get(h.full.presentationsAtom)).toBe(presentations);
      expect(h.registry.get(h.full.providersByEnvironmentAtom).get(FIRST)).toBe(providers);
      expect(
        h.registry.get(h.full.presentationsWithProvidersAtom).get(FIRST)?.serverConfig,
      ).toEqual({ ...base, providers });
      expect(h.registry.get(h.full.serverConfigsAtom)).toBe(configs);
      expect(pushes.presentations).toBe(before.presentations);
      expect(pushes.configs).toBe(before.configs);
      expect(pushes.providers).toBe(before.providers + 1);

      h.registry.set(h.configs(FIRST), { ...base, cwd: "/moved", providers } as ServerConfig);
      expect(h.registry.get(h.full.presentationsAtom).get(FIRST)?.serverConfig?.cwd).toBe("/moved");
      expect(h.registry.get(h.full.serverConfigsAtom).get(FIRST)?.cwd).toBe("/moved");
      expect(h.registry.get(h.full.providersByEnvironmentAtom).get(FIRST)).toBe(providers);
    } finally {
      stops.forEach((stop) => stop());
      h.registry.dispose();
    }
  });

  it("keeps connected search targets stable through config refreshes and updates them on disconnect", () => {
    const h = harness();
    let changes = 0;
    const stop = h.registry.subscribe(h.connectedEnvironmentIdsAtom, () => changes++);
    try {
      expect(h.registry.get(h.connectedEnvironmentIdsAtom)).toEqual([]);
      h.registry.set(
        h.state,
        AsyncResult.success({
          ...AVAILABLE_CONNECTION_STATE,
          phase: "connected",
          generation: 1,
        }),
      );
      const connected = h.registry.get(h.connectedEnvironmentIdsAtom);
      expect(connected).toEqual([FIRST, SECOND]);
      const connectionChanges = changes;
      expect(connectionChanges).toBeGreaterThan(0);
      for (let index = 0; index < 20; index++) {
        h.registry.set(h.configs(FIRST), config(`/workspace-${index}`));
        expect(h.registry.get(h.connectedEnvironmentIdsAtom)).toBe(connected);
      }
      expect(changes).toBe(connectionChanges);
      h.registry.set(h.state, AsyncResult.success(AVAILABLE_CONNECTION_STATE));
      expect(h.registry.get(h.connectedEnvironmentIdsAtom)).toEqual([]);
      expect(changes).toBeGreaterThan(connectionChanges);
    } finally {
      stop();
      h.registry.dispose();
    }
  });

  it("updates machine icons and preserves cached icons for disabled environments", () => {
    const h = harness();
    try {
      expect(h.registry.get(h.machineByIdAtom).get(FIRST)).toBe("desktop");
      h.registry.set(h.configs(FIRST), {
        ...config(),
        settings: { environmentIcon: "laptop" },
      } as ServerConfig);
      expect(h.registry.get(h.machineByIdAtom).get(FIRST)).toBe("laptop");
      h.registry.set(h.catalog, {
        isReady: true,
        entries: new Map([[FIRST, { ...entry(FIRST), enabled: false }]]),
      });
      expect(h.registry.get(h.machineByIdAtom)).toEqual(new Map([[FIRST, "laptop"]]));
      h.registry.set(h.configs(FIRST), null);
      expect(h.registry.get(h.machineByIdAtom).get(FIRST)).toBe("server");
    } finally {
      h.registry.dispose();
    }
  });

  it("tracks loaded configs across environments, config loss and removal", () => {
    const h = harness();
    const stop = h.registry.subscribe(h.pullRequestsSupportedAtom, () => {});
    try {
      h.registry.set(h.configs(FIRST), null);
      h.registry.set(h.configs(SECOND), null);
      expect(h.registry.get(h.pullRequestsSupportedAtom)).toBe(false);
      h.registry.set(h.configs(FIRST), config());
      expect(h.registry.get(h.pullRequestsSupportedAtom)).toBe(true);
      // The first true result short-circuits: the second must be read when the first loses its config.
      h.registry.set(h.configs(SECOND), config());
      h.registry.set(h.configs(FIRST), null);
      expect(h.registry.get(h.pullRequestsSupportedAtom)).toBe(true);
      h.registry.set(h.catalog, { isReady: true, entries: new Map([[FIRST, entry(FIRST)]]) });
      expect(h.registry.get(h.pullRequestsSupportedAtom)).toBe(false);
      expect(h.registry.get(h.environmentIdsAtom)).toEqual([FIRST]);
      expect(h.registry.get(h.identitiesAtom)).toEqual([{ environmentId: FIRST, label: "first" }]);
      h.registry.set(h.catalog, {
        isReady: true,
        entries: new Map([
          [SECOND, entry(SECOND)],
          [FIRST, entry(FIRST)],
        ]),
      });
      expect(h.registry.get(h.environmentIdsAtom)).toEqual([SECOND, FIRST]);
      expect(h.registry.get(h.pullRequestsSupportedAtom)).toBe(true);
      h.registry.set(h.configs(SECOND), null);
      expect(h.registry.get(h.pullRequestsSupportedAtom)).toBe(false);
      h.registry.set(h.catalog, { isReady: true, entries: new Map() });
      expect(h.registry.get(h.environmentIdsAtom)).toEqual([]);
      expect(h.registry.get(h.identitiesAtom)).toEqual([]);
      expect(h.registry.get(h.environmentsAtom)).toEqual([]);
    } finally {
      stop();
      h.registry.dispose();
    }
  });
});

describe("presentations with providers", () => {
  it("leaves out disabled connections until they are re-enabled", () => {
    const h = harness();
    const atom = h.full.presentationsWithProvidersAtom;
    const withSecond = (enabled: boolean): EnvironmentCatalogState => ({
      isReady: true,
      entries: new Map([
        [FIRST, entry(FIRST)],
        [SECOND, { ...entry(SECOND), enabled }],
      ]),
    });
    const stop = h.registry.subscribe(atom, () => {});
    try {
      h.registry.set(h.configs(SECOND), config("/second"));
      h.registry.set(h.catalog, withSecond(false));
      expect([...h.registry.get(atom).keys()]).toEqual([FIRST]);
      expect(h.registry.get(h.full.presentationsAtom).has(SECOND)).toBe(true);
      h.registry.set(h.catalog, withSecond(true));
      expect([...h.registry.get(atom).keys()]).toEqual([FIRST, SECOND]);
      expect(h.registry.get(atom).get(SECOND)?.serverConfig?.cwd).toBe("/second");
    } finally {
      stop();
      h.registry.dispose();
    }
  });

  it("leaves out unsupported environments", () => {
    const h = harness();
    const atom = h.full.presentationsWithProvidersAtom;
    const stop = h.registry.subscribe(atom, () => {});
    try {
      h.registry.set(h.catalog, {
        isReady: true,
        entries: new Map<EnvironmentId, ConnectionCatalogEntry>([
          [FIRST, entry(FIRST)],
          [SECOND, { ...entry(SECOND), unsupportedReason: "Server is too old." }],
        ]),
      });
      expect([...h.registry.get(atom).keys()]).toEqual([FIRST]);
    } finally {
      stop();
      h.registry.dispose();
    }
  });
});
