import type { ConnectionTarget } from "@supaterm/client-runtime/connection";
import {
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  type DesktopBridge,
  type DesktopEnvironmentBootstrap,
} from "@supaterm/contracts";

/**
 * The renderer's only signal that a connection is a host-managed local backend (e.g. WSL) rather
 * than a saved remote or SSH environment. Mint ids via {@link desktopLocalConnectionId} and
 * classify via {@link isDesktopLocalConnectionTarget} so the convention cannot drift.
 */
const DESKTOP_LOCAL_CONNECTION_ID_PREFIX = "local:";

export function desktopLocalConnectionId(backendId: string): string {
  return `${DESKTOP_LOCAL_CONNECTION_ID_PREFIX}${backendId}`;
}

export function isDesktopLocalConnectionTarget(
  target: ConnectionTarget,
): target is Extract<ConnectionTarget, { readonly _tag: "BearerConnectionTarget" }> {
  return (
    target._tag === "BearerConnectionTarget" &&
    target.connectionId.startsWith(DESKTOP_LOCAL_CONNECTION_ID_PREFIX)
  );
}

export function desktopLocalBackendId(target: ConnectionTarget): string | null {
  return isDesktopLocalConnectionTarget(target)
    ? target.connectionId.slice(DESKTOP_LOCAL_CONNECTION_ID_PREFIX.length)
    : null;
}

export type DesktopSecondaryBootstrapsRead =
  | {
      readonly _tag: "Success";
      readonly bootstraps: ReadonlyArray<DesktopEnvironmentBootstrap>;
    }
  | {
      readonly _tag: "Failure";
      readonly cause: unknown;
    };

export interface DesktopSecondaryBootstrapsReader {
  readonly readResult: () => DesktopSecondaryBootstrapsRead;
  readonly readSnapshot: () => ReadonlyArray<DesktopEnvironmentBootstrap>;
}

/**
 * A successful empty read is authoritative; a thrown read preserves the previous snapshot so UI
 * consumers cannot temporarily disagree with the platform's retained registrations.
 */
export function createDesktopSecondaryBootstrapsReader(
  resolveBridge: () => Pick<DesktopBridge, "getLocalEnvironmentBootstraps"> | undefined,
): DesktopSecondaryBootstrapsReader {
  let snapshot: ReadonlyArray<DesktopEnvironmentBootstrap> = [];

  const readResult = (): DesktopSecondaryBootstrapsRead => {
    const bridge = resolveBridge();
    if (bridge === undefined) {
      if (snapshot.length > 0) snapshot = [];
      return { _tag: "Success", bootstraps: snapshot };
    }
    try {
      const next = bridge
        .getLocalEnvironmentBootstraps()
        .filter((entry) => entry.id !== PRIMARY_LOCAL_ENVIRONMENT_ID);
      if (
        next.length !== snapshot.length ||
        next.some((entry, index) => {
          const previous = snapshot[index];
          return (
            previous === undefined ||
            entry.id !== previous.id ||
            entry.label !== previous.label ||
            entry.runningDistro !== previous.runningDistro ||
            entry.httpBaseUrl !== previous.httpBaseUrl ||
            entry.wsBaseUrl !== previous.wsBaseUrl ||
            entry.bootstrapToken !== previous.bootstrapToken
          );
        })
      ) {
        snapshot = next;
      }
      return { _tag: "Success", bootstraps: snapshot };
    } catch (cause) {
      return { _tag: "Failure", cause };
    }
  };

  return {
    readResult,
    readSnapshot: () => {
      const result = readResult();
      return result._tag === "Success" ? result.bootstraps : snapshot;
    },
  };
}

const desktopSecondaryBootstrapsReader = createDesktopSecondaryBootstrapsReader(
  () => window.desktopBridge,
);

export function readDesktopSecondaryBootstrapsResult(): DesktopSecondaryBootstrapsRead {
  return desktopSecondaryBootstrapsReader.readResult();
}

export function readDesktopSecondaryBootstraps(): ReadonlyArray<DesktopEnvironmentBootstrap> {
  return desktopSecondaryBootstrapsReader.readSnapshot();
}
