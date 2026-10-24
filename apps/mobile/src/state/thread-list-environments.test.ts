import {
  EnvironmentId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerConfig,
  type ServerProvider,
} from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import { Atom, AtomRegistry } from "effect/reactivity";
import { createThreadListEnvironmentsAtom } from "./thread-list-environments";

const ID = EnvironmentId.make("one");
const OTHER_ID = EnvironmentId.make("two");
const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-01T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};
const config = {
  providers: [provider],
  environment: { capabilities: {}, platform: { machine: "laptop" } },
  settings: {},
} as unknown as ServerConfig;

function harness() {
  const registry = AtomRegistry.make();
  const configs = Atom.make<ReadonlyMap<EnvironmentId, ServerConfig>>(
    new Map([
      [ID, config],
      [OTHER_ID, config],
    ]),
  );
  const list = createThreadListEnvironmentsAtom(configs);
  let sourceNotifications = 0;
  let listNotifications = 0;
  registry.subscribe(configs, () => sourceNotifications++);
  registry.subscribe(list, () => listNotifications++);
  registry.get(list);
  sourceNotifications = 0;
  listNotifications = 0;
  return {
    registry,
    configs,
    list,
    read: () => registry.get(list),
    write: (next: ServerConfig) =>
      registry.set(
        configs,
        new Map([
          [ID, next],
          [OTHER_ID, config],
        ]),
      ),
    notifications: () => ({ source: sourceNotifications, list: listNotifications }),
  };
}

describe("thread list environment projection", () => {
  it("tracks loaded environments for thread actions", () => {
    const h = harness();
    try {
      expect([...h.read().loadedEnvironmentIds]).toEqual([ID, OTHER_ID]);
      h.registry.set(h.configs, new Map([[ID, config]]));
      expect([...h.read().loadedEnvironmentIds]).toEqual([ID]);
      h.registry.set(h.configs, new Map());
      expect(h.read().loadedEnvironmentIds.size).toBe(0);
    } finally {
      h.registry.dispose();
    }
  });
});
