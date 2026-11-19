import type { DesktopBridge, DesktopDiscoveredSshHost } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

type DesktopSshDiscoveryBridge = Pick<DesktopBridge, "discoverSshHosts">;

export function filterDiscoveredSshHosts(
  hosts: ReadonlyArray<DesktopDiscoveredSshHost>,
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return hosts;

  const prefixMatches: Array<DesktopDiscoveredSshHost> = [];
  const substringMatches: Array<DesktopDiscoveredSshHost> = [];
  for (const host of hosts) {
    const alias = host.alias.toLowerCase();
    if (alias.startsWith(normalizedQuery)) {
      prefixMatches.push(host);
    } else if (
      alias.includes(normalizedQuery) ||
      host.hostname.toLowerCase().includes(normalizedQuery)
    ) {
      substringMatches.push(host);
    }
  }

  return [...prefixMatches, ...substringMatches];
}

class DesktopSshDiscoveryUnavailableError extends Schema.TaggedError<DesktopSshDiscoveryUnavailableError>()(
  "DesktopSshDiscoveryUnavailableError",
  {},
) {
  override get message() {
    return "Desktop SSH host discovery is unavailable.";
  }
}

class DesktopSshDiscoveryError extends Schema.TaggedError<DesktopSshDiscoveryError>()(
  "DesktopSshDiscoveryError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "Failed to discover SSH hosts.";
  }
}

function getDesktopSshDiscoveryBridge() {
  return typeof window === "undefined" ? undefined : window.desktopBridge;
}

function createDesktopSshHostsStateAtom(getBridge: () => DesktopSshDiscoveryBridge | undefined) {
  const discoverDesktopSshHosts = Effect.fn("discoverDesktopSshHosts")(function* () {
    const bridge = getBridge();
    if (!bridge) {
      return yield* new DesktopSshDiscoveryUnavailableError();
    }
    return yield* Effect.tryPromise({
      try: () => bridge.discoverSshHosts(),
      catch: (cause) => new DesktopSshDiscoveryError({ cause }),
    });
  });

  return Atom.make(discoverDesktopSshHosts()).pipe(
    Atom.swr({ staleTime: 30_000, revalidateOnMount: true }),
    Atom.keepAlive,
    Atom.withLabel("desktop:ssh-hosts"),
  );
}

export const desktopSshHostsStateAtom = createDesktopSshHostsStateAtom(
  getDesktopSshDiscoveryBridge,
);
