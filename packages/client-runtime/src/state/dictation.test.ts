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
  } = {},
): ServerConfig {
  return {
    environment: {
      capabilities: options.supported === false ? {} : { dictation: capability },
    },
    settings: { dictation: { enabled: options.enabled ?? true, source: null } },
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
      state: registry.get(atoms.environmentStateAtom(ENV)),
      threadInstanceId: null,
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
    h.registry.set(h.configAtom, config());
    expect(
      resolveDictationAvailability({
        state: {
          status: "offered",
          offer: { capability, sources: [source("a")], settings: { enabled: true, source: null } },
        },
        threadInstanceId: null,
        captureSupported: false,
      } as Parameters<typeof resolveDictationAvailability>[0]),
    ).toEqual({ kind: "hidden", reason: "no-capture" });
  });

  it("prefers the thread's own eligible instance", () => {
    expect(
      resolveDictationAvailability({
        state: {
          status: "offered",
          offer: {
            capability,
            sources: [source("a"), source("b")],
            settings: { enabled: true, source: null },
          },
        },
        threadInstanceId: ProviderInstanceId.make("b"),
        captureSupported: true,
      } as Parameters<typeof resolveDictationAvailability>[0]),
    ).toMatchObject({ kind: "available", source: { id: "codex:b" } });
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
