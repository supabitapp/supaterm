import { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  SshConnectionProfile,
  SshConnectionRegistration,
} from "../connection/catalog.ts";
import {
  BearerConnectionTarget,
  ConnectionTransientError,
  PrimaryConnectionTarget,
  SshConnectionTarget,
} from "../connection/model.ts";
import {
  GitHubRoutingPermissions,
  makeGitHubRoutingPermissions,
} from "../connection/githubRoutingPermissions.ts";
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
  registerConnectionInCatalog,
  removeConnectionFromCatalog,
  setRoutesInCatalog,
  setConnectionEnabledInCatalog,
} from "./storageDocument.ts";

const decodeConnectionCatalogDocument = Schema.decodeUnknownEffect(ConnectionCatalogDocument);

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const decodeCatalogDocument = Schema.decodeUnknownSync(ConnectionCatalogDocument);

const BEARER_TARGET = new BearerConnectionTarget({
  environmentId: ENVIRONMENT_ID,
  label: "Remote",
  connectionId: "bearer-1",
});
const BEARER_PROFILE = new BearerConnectionProfile({
  connectionId: BEARER_TARGET.connectionId,
  environmentId: ENVIRONMENT_ID,
  label: BEARER_TARGET.label,
  httpBaseUrl: "https://remote.example.test",
  wsBaseUrl: "wss://remote.example.test",
});
const BEARER_CREDENTIAL = new BearerConnectionCredential({
  token: "bearer-token",
});
const SSH_TARGET = new SshConnectionTarget({
  environmentId: ENVIRONMENT_ID,
  label: "SSH",
  connectionId: "ssh-1",
});
const SSH_PROFILE = new SshConnectionProfile({
  connectionId: SSH_TARGET.connectionId,
  environmentId: ENVIRONMENT_ID,
  label: SSH_TARGET.label,
  target: { alias: "work", hostname: "work.example.test", username: "maria", port: 22 },
});

describe("ConnectionCatalogDocument", () => {
  it("persists learned relay metadata with its routes and keeps the paired credential", () => {
    const initial = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );
    const target = new BearerConnectionTarget({
      ...BEARER_TARGET,
      connectionId: `learned:relay@${BEARER_TARGET.connectionId}`,
    });
    const profile = new BearerConnectionProfile({
      ...BEARER_PROFILE,
      connectionId: target.connectionId,
      httpBaseUrl: `https://${"a".repeat(32)}.${"b".repeat(32)}.relay.supaterm.invalid/`,
      relayUrl: "wss://relay-a.example",
      learned: true,
    });
    const added = setRoutesInCatalog(initial, ENVIRONMENT_ID, [BEARER_TARGET, target], [profile]);
    const moved = new BearerConnectionProfile({ ...profile, relayUrl: "wss://relay-b.example" });
    const updated = setRoutesInCatalog(added, ENVIRONMENT_ID, [BEARER_TARGET, target], [moved]);
    const restored = decodeCatalogDocument(JSON.parse(JSON.stringify(updated)));
    expect(restored.targets).toEqual([BEARER_TARGET, target]);
    expect(restored.profiles).toEqual([BEARER_PROFILE, moved]);
    expect(restored.credentials).toEqual(initial.credentials);
    expect(added.profiles).toEqual([BEARER_PROFILE, profile]);
    const withdrawn = setRoutesInCatalog(restored, ENVIRONMENT_ID, [BEARER_TARGET]);
    expect(withdrawn.profiles).toEqual([BEARER_PROFILE]);
    expect(withdrawn.credentials).toEqual(initial.credentials);
  });

  it.effect("persists explicit GitHub trust and forgets it when a connection is removed", () =>
    Effect.gen(function* () {
      let document = EMPTY_CONNECTION_CATALOG_DOCUMENT;
      const entry = { target: BEARER_TARGET, profile: Option.some(BEARER_PROFILE), enabled: true };
      const storage = {
        read: Effect.sync(() => document.githubRoutingPermissions ?? []),
        write: (githubRoutingPermissions: NonNullable<typeof document.githubRoutingPermissions>) =>
          Effect.gen(function* () {
            document = yield* decodeConnectionCatalogDocument({
              ...document,
              githubRoutingPermissions,
            }).pipe(Effect.orDie);
          }),
      };
      const permissions = yield* makeGitHubRoutingPermissions(storage);
      expect(yield* permissions.get(entry)).toBe("off");
      yield* permissions.set(entry, "read");
      const restarted = yield* makeGitHubRoutingPermissions(storage);
      expect(yield* restarted.get(entry)).toBe("read");

      const changedEndpoint = {
        ...entry,
        profile: Option.some(
          new BearerConnectionProfile({
            ...BEARER_PROFILE,
            httpBaseUrl: "https://different.example.test",
          }),
        ),
      };
      expect(yield* restarted.get(changedEndpoint)).toBe("off");
      expect(
        yield* restarted.get({
          ...entry,
          profile: Option.some(
            new BearerConnectionProfile({
              ...BEARER_PROFILE,
              wsBaseUrl: "wss://different.example.test",
            }),
          ),
        }),
      ).toBe("off");
      expect(
        yield* restarted.get({
          target: SSH_TARGET,
          profile: Option.some(SSH_PROFILE),
          enabled: true,
        }),
      ).toBe("off");
      yield* restarted.set(entry, "read-write");
      expect(yield* restarted.get(entry)).toBe("read-write");
      yield* restarted.forget(ENVIRONMENT_ID);
      expect(yield* restarted.get(entry)).toBe("off");
      const afterRemoval = yield* makeGitHubRoutingPermissions(storage);
      expect(yield* afterRemoval.get(entry)).toBe("off");

      yield* permissions.set(entry, "read");
      document = removeConnectionFromCatalog(document, BEARER_TARGET);
      const afterCatalogRemoval = yield* makeGitHubRoutingPermissions(storage);
      expect(yield* afterCatalogRemoval.get(entry)).toBe("off");
    }),
  );

  it.effect("requires explicit trust for primary and SSH connections independently", () =>
    Effect.gen(function* () {
      const permissions = yield* makeGitHubRoutingPermissions({
        read: Effect.succeed([]),
        write: () => Effect.void,
      });
      const entries = [
        {
          target: new PrimaryConnectionTarget({
            environmentId: ENVIRONMENT_ID,
            label: "Local",
            httpBaseUrl: "http://localhost:3000",
            wsBaseUrl: "ws://localhost:3000",
          }),
          profile: Option.none(),
          enabled: true,
        },
        { target: SSH_TARGET, profile: Option.some(SSH_PROFILE), enabled: true },
      ];
      for (const entry of entries) {
        expect(yield* permissions.get(entry)).toBe("off");
        yield* permissions.set(entry, "read");
        expect(yield* permissions.get(entry)).toBe("read");
        yield* permissions.set(entry, "off");
        expect(yield* permissions.get(entry)).toBe("off");
      }
    }),
  );

  it.effect("does not enable GitHub routing when permission persistence fails", () =>
    Effect.gen(function* () {
      const entry = { target: BEARER_TARGET, profile: Option.some(BEARER_PROFILE), enabled: true };
      expect(yield* (yield* GitHubRoutingPermissions).get(entry)).toBe("off");
      const permissions = yield* makeGitHubRoutingPermissions({
        read: Effect.succeed([]),
        write: () =>
          Effect.fail(
            new ConnectionTransientError({
              reason: "remote-unavailable",
              detail: "storage unavailable",
            }),
          ),
      });
      yield* permissions.set(entry, "read-write").pipe(Effect.flip);
      expect(yield* permissions.get(entry)).toBe("off");
    }),
  );

  it("registers a bearer connection as one catalog mutation", () => {
    const document = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );

    expect(document.targets).toEqual([BEARER_TARGET]);
    expect(document.profiles).toEqual([BEARER_PROFILE]);
    expect(document.credentials).toEqual([
      {
        connectionId: BEARER_TARGET.connectionId,
        credential: BEARER_CREDENTIAL,
      },
    ]);
  });

  it("replaces obsolete connection metadata when an environment changes connection kind", () => {
    const bearer = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );
    const ssh = registerConnectionInCatalog(
      bearer,
      new SshConnectionRegistration({
        target: SSH_TARGET,
        profile: SSH_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );

    expect(ssh.targets).toEqual([SSH_TARGET]);
    expect(ssh.profiles).toEqual([SSH_PROFILE]);
    expect(ssh.credentials).toEqual([
      { connectionId: SSH_TARGET.connectionId, credential: BEARER_CREDENTIAL },
    ]);
  });

  it("removes every catalog record owned by an explicit disconnect", () => {
    const registered = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );

    expect(removeConnectionFromCatalog(registered, BEARER_TARGET)).toEqual(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
    );
  });

  it("decodes a document written before the disabled list existed", () => {
    const decoded = decodeCatalogDocument({
      schemaVersion: 1,
      targets: [],
      profiles: [],
      credentials: [],
    });

    expect(decoded.disabledEnvironmentIds).toEqual([]);
  });

  it("drops retired relay targets and DPoP tokens from a stored catalog", () => {
    const schema = Schema.fromJsonString(ConnectionCatalogDocument);
    const relayEnvironmentId = "environment-relay";
    const decoded = Schema.decodeSync(schema)(
      JSON.stringify({
        schemaVersion: 1,
        targets: [
          { _tag: "RelayConnectionTarget", environmentId: relayEnvironmentId, label: "Relay" },
          {
            _tag: "BearerConnectionTarget",
            environmentId: ENVIRONMENT_ID,
            label: BEARER_TARGET.label,
            connectionId: BEARER_TARGET.connectionId,
          },
        ],
        profiles: [
          {
            _tag: "BearerConnectionProfile",
            connectionId: BEARER_PROFILE.connectionId,
            environmentId: ENVIRONMENT_ID,
            label: BEARER_PROFILE.label,
            httpBaseUrl: BEARER_PROFILE.httpBaseUrl,
            wsBaseUrl: BEARER_PROFILE.wsBaseUrl,
          },
        ],
        credentials: [
          {
            connectionId: BEARER_TARGET.connectionId,
            credential: { _tag: "BearerConnectionCredential", token: BEARER_CREDENTIAL.token },
          },
        ],
        remoteDpopTokens: [
          {
            _tag: "RemoteDpopAccessToken",
            environmentId: relayEnvironmentId,
            label: "Relay",
            accessToken: "dpop-token",
            expiresAtEpochMs: 1_000_000,
            dpopThumbprint: "thumbprint",
          },
        ],
        disabledEnvironmentIds: [],
      }),
    );

    expect(decoded.targets).toEqual([BEARER_TARGET]);
    expect(decoded.profiles).toEqual([BEARER_PROFILE]);
    expect(decoded.credentials).toEqual([
      { connectionId: BEARER_TARGET.connectionId, credential: BEARER_CREDENTIAL },
    ]);
    expect(Schema.encodeSync(schema)(decoded)).not.toContain("remoteDpopTokens");
  });

  it("re-pairs a retired relay environment as enabled", () => {
    const decoded = decodeCatalogDocument({
      schemaVersion: 1,
      targets: [{ _tag: "RelayConnectionTarget", environmentId: ENVIRONMENT_ID, label: "Relay" }],
      profiles: [],
      credentials: [],
      disabledEnvironmentIds: [ENVIRONMENT_ID],
    });

    const registered = registerConnectionInCatalog(
      decoded,
      new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );

    expect(registered.targets).toEqual([BEARER_TARGET]);
    expect(registered.disabledEnvironmentIds).toEqual([]);
  });

  it("switches a saved environment off and back on without touching its records", () => {
    const registered = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );

    const disabled = setConnectionEnabledInCatalog(registered, ENVIRONMENT_ID, false);
    expect(disabled.disabledEnvironmentIds).toEqual([ENVIRONMENT_ID]);
    expect(disabled.targets).toEqual(registered.targets);
    expect(disabled.credentials).toEqual(registered.credentials);
    expect(
      setConnectionEnabledInCatalog(disabled, ENVIRONMENT_ID, false).disabledEnvironmentIds,
    ).toEqual([ENVIRONMENT_ID]);

    expect(
      setConnectionEnabledInCatalog(disabled, ENVIRONMENT_ID, true).disabledEnvironmentIds,
    ).toEqual([]);
    expect(
      registerConnectionInCatalog(
        disabled,
        new BearerConnectionRegistration({
          target: BEARER_TARGET,
          profile: BEARER_PROFILE,
          credential: BEARER_CREDENTIAL,
        }),
      ).disabledEnvironmentIds,
    ).toEqual([ENVIRONMENT_ID]);
    expect(removeConnectionFromCatalog(disabled, BEARER_TARGET).disabledEnvironmentIds).toEqual([]);
  });

  it("persists the normalized SSH profile and its paired token beside its target", () => {
    const target = new SshConnectionTarget({
      environmentId: ENVIRONMENT_ID,
      label: "SSH",
      connectionId: "ssh-1",
    });
    const profile = new SshConnectionProfile({
      connectionId: target.connectionId,
      environmentId: target.environmentId,
      label: target.label,
      target: {
        alias: "devbox",
        hostname: "devbox.example.test",
        username: "developer",
        port: 22,
      },
    });
    const document = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new SshConnectionRegistration({ target, profile, credential: BEARER_CREDENTIAL }),
    );

    expect(document.targets).toEqual([target]);
    expect(document.profiles).toEqual([profile]);
    expect(document.credentials).toEqual([
      { connectionId: target.connectionId, credential: BEARER_CREDENTIAL },
    ]);
    // Removing the route forgets its token too.
    expect(removeConnectionFromCatalog(document, ENVIRONMENT_ID).credentials).toEqual([]);
  });
});
