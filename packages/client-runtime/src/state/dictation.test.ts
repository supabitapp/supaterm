import { describe, expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  ProviderInstanceId,
  type AuthSessionState,
  type DictationSourceDescriptor,
  type ServerConfig,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import {
  createDictationAvailabilityAtoms,
  dictationSourceLabel,
  resolveDictationAvailability,
  resolveDictationRoute,
  type DictationEnvironmentState,
} from "./dictation.ts";

const ENV = EnvironmentId.make("env");
const capability = { maxClipBytes: 20 * 1024 * 1024, maxDurationMs: 300_000 };

function source(
  instance: string,
  overrides: Partial<DictationSourceDescriptor> = {},
): DictationSourceDescriptor {
  return {
    id: `codex:${instance}`,
    kind: "codex",
    runsOn: "environment",
    label: `Codex ${instance}`,
    serviceLabel: "ChatGPT",
    accountLabel: `${instance}@example.com`,
    providerInstanceId: ProviderInstanceId.make(instance),
    eligible: true,
    audioFormats: ["webm"],
    ...overrides,
  } as DictationSourceDescriptor;
}

function config(
  options: {
    readonly sources?: ReadonlyArray<DictationSourceDescriptor>;
    readonly enabled?: boolean;
    readonly supported?: boolean;
    readonly chosen?: string | null;
  } = {},
): ServerConfig {
  return {
    environment: {
      capabilities: options.supported === false ? {} : { dictation: capability },
    },
    settings: {
      dictation: {
        enabled: options.enabled ?? true,
        source: options.chosen === undefined ? "codex:work" : options.chosen,
      },
    },
    dictation: { sources: options.sources ?? [source("work")] },
  } as unknown as ServerConfig;
}

const session = (scopes: ReadonlyArray<string>): AuthSessionState =>
  ({
    authenticated: true,
    auth: { policy: "remote-reachable", bootstrapMethods: [], sessionMethods: [] },
    scopes,
  }) as unknown as AuthSessionState;

function harness() {
  const configAtom = Atom.make<ServerConfig | null>(config());
  const sessionAtom = Atom.make<AsyncResult.AsyncResult<AuthSessionState, unknown>>(
    AsyncResult.success(session([AuthOrchestrationOperateScope])),
  );
  const atoms = createDictationAvailabilityAtoms({
    serverConfigValueAtom: () => configAtom,
    sessionStateAtom: () => sessionAtom,
  });
  const registry = AtomRegistry.make();
  const read = () =>
    resolveDictationAvailability({
      environmentId: ENV,
      state: registry.get(atoms.environmentStateAtom(ENV)),
      captureSupported: true,
    });
  return { configAtom, sessionAtom, registry, read };
}

describe("dictation availability", () => {
  it("offers the resolved source when the environment can transcribe for this connection", () => {
    const h = harness();
    expect(h.read()).toMatchObject({ kind: "available", source: { id: "codex:work" }, capability });
  });

  it("keeps the last known offer while the environment reconnects", () => {
    const h = harness();
    expect(h.read().kind).toBe("available");
    h.registry.set(h.configAtom, null);
    h.registry.set(h.sessionAtom, AsyncResult.initial());
    expect(h.read()).toMatchObject({ kind: "available", source: { id: "codex:work" } });
    h.registry.set(h.sessionAtom, AsyncResult.failure(Cause.fail("disconnected")));
    expect(h.read().kind).toBe("available");
  });

  it("replaces the cached offer with a definitive answer", () => {
    const h = harness();
    expect(h.read().kind).toBe("available");
    h.registry.set(h.configAtom, config({ sources: [source("work", { eligible: false })] }));
    expect(h.read()).toMatchObject({ kind: "unavailable", source: { id: "codex:work" } });
    h.registry.set(
      h.configAtom,
      config({ chosen: null, sources: [source("work", { eligible: false })] }),
    );
    expect(h.read()).toEqual({ kind: "hidden", reason: "no-source" });
    h.registry.set(h.configAtom, config({ enabled: false }));
    expect(h.read()).toEqual({ kind: "hidden", reason: "disabled" });
    h.registry.set(h.configAtom, config({ supported: false }));
    expect(h.read()).toEqual({ kind: "hidden", reason: "unsupported" });
    h.registry.set(h.configAtom, config());
    h.registry.set(h.sessionAtom, AsyncResult.success(session([])));
    expect(h.read()).toEqual({ kind: "hidden", reason: "forbidden" });
    h.registry.set(h.configAtom, null);
    h.registry.set(h.sessionAtom, AsyncResult.initial());
    expect(h.read()).toEqual({ kind: "hidden", reason: "forbidden" });
  });

  it("hides the microphone until availability was ever learned or capture works", () => {
    const h = harness();
    h.registry.set(h.configAtom, null);
    expect(h.read()).toEqual({ kind: "hidden", reason: "unknown" });
    expect(
      resolveDictationAvailability({
        environmentId: ENV,
        state: offered([source("a")], "codex:a"),
        captureSupported: false,
      }),
    ).toEqual({ kind: "hidden", reason: "no-capture" });
  });

  it("asks for a source until one is chosen, without picking one itself", () => {
    expect(
      resolveDictationAvailability({
        environmentId: ENV,
        state: offered([source("a"), source("b", { eligible: false })], null),
        captureSupported: true,
      }),
    ).toMatchObject({ kind: "needs-source", sources: [{ id: "codex:a" }] });
  });

  it("names the service and account that transcribe", () => {
    expect(dictationSourceLabel({ serviceLabel: "ChatGPT", accountLabel: "me@example.com" })).toBe(
      "Transcribed with ChatGPT · me@example.com",
    );
    expect(dictationSourceLabel({ serviceLabel: "OpenAI API", accountLabel: null })).toBe(
      "Transcribed with OpenAI API",
    );
  });
});

function offered(
  sources: ReadonlyArray<DictationSourceDescriptor>,
  chosen: string | null,
): DictationEnvironmentState {
  return {
    status: "offered",
    offer: {
      capability,
      sources,
      settings: { enabled: true, source: chosen as DictationSourceDescriptor["id"] | null },
    },
  };
}

describe("dictation routing", () => {
  const LOCAL = EnvironmentId.make("local");
  const REMOTE = EnvironmentId.make("remote");
  const ready = offered([source("work")], "codex:work");
  const unchosen = offered([source("work")], null);
  const route = (
    states: Partial<Record<string, DictationEnvironmentState>>,
    options: {
      readonly routing?: Parameters<typeof resolveDictationRoute>[0]["routing"];
      readonly local?: EnvironmentId | null;
    } = {},
  ) =>
    resolveDictationRoute({
      routing: options.routing ?? { mode: "automatic" },
      draftEnvironmentId: REMOTE,
      localEnvironmentId: options.local === undefined ? LOCAL : options.local,
      stateFor: (environmentId) => states[environmentId] ?? { status: "unknown" },
      captureSupported: true,
    });

  it("transcribes on this computer even when the thread lives elsewhere", () => {
    expect(route({ local: ready, remote: ready })).toMatchObject({
      kind: "available",
      environmentId: LOCAL,
    });
  });

  it("uses the thread's environment when this computer has no ready source", () => {
    expect(route({ local: unchosen, remote: ready })).toMatchObject({
      kind: "available",
      environmentId: REMOTE,
    });
    expect(route({ remote: ready })).toMatchObject({ kind: "available", environmentId: REMOTE });
    expect(route({ remote: ready }, { local: null })).toMatchObject({ environmentId: REMOTE });
  });

  it("asks to set up this computer before falling back to nothing", () => {
    expect(route({ local: unchosen, remote: { status: "unsupported" } })).toMatchObject({
      kind: "needs-source",
      environmentId: LOCAL,
    });
  });

  it("never leaves a pinned environment", () => {
    expect(
      route(
        { local: ready, remote: { status: "unsupported" } },
        { routing: { mode: "pinned", environmentId: REMOTE } },
      ),
    ).toEqual({ kind: "hidden", reason: "unsupported" });
  });
});
