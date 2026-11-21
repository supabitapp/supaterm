import {
  AuthMcpClientAccess,
  AuthMcpRegistrationError,
  AuthMcpTokenError,
  EnvironmentHttpApi,
  EnvironmentId,
  type ExecutionEnvironmentCapabilities,
  MCP_PEER_LINK_SOFTWARE_ID,
  type PeerLink,
  type PeerLinkCreateInput,
  PeerLinkError,
  type PeerLinkSummary,
} from "@supaterm/contracts";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import { isLocalLoopbackHost, isTailnetHost } from "@supaterm/shared/hostClassification";
import { canonicalRelayAddress } from "@supaterm/shared/relay/protocol";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as RelayCompanion from "../relay/RelayCompanion.ts";

const PeerHttpApi = HttpApi.make(EnvironmentHttpApi.identifier)
  .add(EnvironmentHttpApi.groups.metadata)
  .add(EnvironmentHttpApi.groups.mcpOAuth)
  .annotateMerge(EnvironmentHttpApi.annotations);

/** The redirect registered for a link. Nothing ever listens there: the code comes back in the response. */
const LINK_REDIRECT_URI = "http://127.0.0.1/supaterm-peer-link";
/**
 * How long a peer's descriptor or MCP handshake may take before a route counts
 * as unreachable. A tailnet or relayed route to a machine that is waking up takes longer.
 */
export const probeTimeout = (origin: string) =>
  isLocalLoopbackHost(new URL(origin).hostname) ? Duration.seconds(3) : Duration.seconds(10);
/** How long a listing waits on a link's addresses; a real call still gives a waking peer `probeTimeout`. */
const LIST_PROBE_TIMEOUT = Duration.seconds(3);

/** Node's TLS verification code in a failed request's cause chain, if any. */
export const certificateErrorCode = (error: unknown) => {
  let current = error;
  for (let depth = 0; depth < 6 && Predicate.isObject(current); depth++) {
    if (
      Predicate.hasProperty(current, "code") &&
      typeof current.code === "string" &&
      /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|INVALID_(CA|PURPOSE)|PATH_LENGTH_EXCEEDED|HOSTNAME_MISMATCH/.test(
        current.code,
      )
    )
      return current.code;
    current = Predicate.hasProperty(current, "cause") ? current.cause : undefined;
  }
  return undefined;
};

/** A usable link: where to reach the peer and the token to send there. */
export interface ResolvedPeerLink {
  readonly link: PeerLink;
  /** The first address that answered as this peer. */
  readonly address: string;
  /** Where requests to that address go: itself, or this server's tunnel to a relay address. */
  readonly url: string;
  readonly token: string;
}

/** What a link names itself on its peer, followed by this environment's label. */
export const LINK_CLIENT_NAME_PREFIX = "Supaterm · ";

/** One owner holds every link's relay tunnel, so a tunnel outlives the client that asked for the link. */
const RELAY_LEASE_OWNER = "peer-links";

/** The relay address `url` names, or null for any other address, a malformed relay one included. */
const relayAddressOf = (url: string) => {
  try {
    return canonicalRelayAddress(url);
  } catch {
    return null;
  }
};

const isRelayAddress = (address: string) => relayAddressOf(address) !== null;

/**
 * Links from this environment to others. Linking signs this environment in to
 * the peer's `/mcp` as an outside agent with a pairing code from the peer, the
 * same MCP OAuth flow an outside agent uses, without a browser. The peer's
 * session token is kept in the server secret store; the table keeps the rest.
 */
export class PeerLinks extends Context.Service<
  PeerLinks,
  {
    readonly link: (input: PeerLinkCreateInput) => Effect.Effect<PeerLink, PeerLinkError>;
    readonly list: Effect.Effect<ReadonlyArray<PeerLinkSummary>, PeerLinkError>;
    /** The stored link, without asking the peer whether it answers. */
    readonly get: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<Option.Option<PeerLink>, PeerLinkError>;
    /** Forgets the link here. The peer still lists the session until it is revoked there. */
    readonly unlink: (environmentId: EnvironmentId) => Effect.Effect<boolean, PeerLinkError>;
    /** Forgets every link here, without asking any peer. Returns how many it forgot. */
    readonly unlinkAll: Effect.Effect<number, PeerLinkError>;
    /**
     * An address that answers as the linked peer, with its token, ready to call. With `linkedAt`,
     * only the link made then resolves: one made again since has another session there.
     */
    readonly resolve: (
      environmentId: EnvironmentId,
      options?: { readonly linkedAt?: string },
    ) => Effect.Effect<ResolvedPeerLink, PeerLinkError>;
    /** Records the outcome of a call, so listing shows whether the peer answered last time. */
    readonly recordOutcome: (
      environmentId: EnvironmentId,
      outcome: { readonly error: string | null },
    ) => Effect.Effect<void>;
  }
>()("supaterm/peer/PeerLinks") {}

interface PeerLinkRow {
  readonly environment_id: string;
  readonly secret_name: string;
  readonly label: string;
  readonly urls_json: string;
  readonly access: string;
  readonly linked_at: string;
  readonly expires_at: string;
  readonly last_reached_at: string | null;
  readonly last_error: string | null;
  readonly relay_url: string | null;
}

const decodeUrls = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String)));
const encodeUrls = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.String)));
const decodeAccess = Schema.decodeUnknownEffect(AuthMcpClientAccess);

/** Fails with a fixed storage error that keeps its cause; the log gets the details. */
const failStorage = (cause: unknown) =>
  Effect.logWarning("Peer link storage failed", cause).pipe(
    Effect.andThen(
      Effect.fail(
        new PeerLinkError({
          reason: "storage",
          message:
            "Linked environments could not be read or saved here. The server log has details.",
          cause,
        }),
      ),
    ),
  );

/**
 * The base URL a peer is reached at, normalised to its origin. The pairing code and then the
 * link's token travel to it, so plain http is accepted only where the network already encrypts:
 * this machine, or a Tailscale address. A relay address is reached only through its tunnel.
 */
const peerOrigin = Effect.fn("PeerLinks.peerOrigin")(function* (url: string) {
  const relay = relayAddressOf(url);
  if (relay !== null) return relay;
  const parsed = URL.parse(url);
  if (parsed === null || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
    return yield* new PeerLinkError({
      reason: "unreachable",
      message: `${url} is not an http or https address.`,
    });
  }
  if (
    parsed.protocol === "http:" &&
    !isLocalLoopbackHost(parsed.hostname) &&
    !isTailnetHost(parsed.hostname)
  ) {
    return yield* new PeerLinkError({
      reason: "unreachable",
      message: `${url} is plain http, which would send the link's credentials unencrypted. Use its https address, or its Tailscale address.`,
    });
  }
  return parsed.origin;
});

/** The system error under a failed connection, such as ECONNREFUSED or ENOTFOUND. */
const connectionCode = (cause: unknown) =>
  [cause, Predicate.hasProperty(cause, "cause") ? cause.cause : undefined]
    .map((error) => (Predicate.hasProperty(error, "code") ? error.code : undefined))
    .find(Predicate.isString);

/** Why `origin` did not answer as Supaterm, short enough for a toast. Never echoes a body. */
const probeFailure = (
  origin: string,
  error: HttpClientError.HttpClientError | Schema.SchemaError | Cause.TimeoutError,
  timeout: Duration.Duration,
) => {
  const unreachable = (message: string) => new PeerLinkError({ reason: "unreachable", message });
  const certificate = certificateErrorCode(error);
  if (certificate !== undefined) {
    return unreachable(`${origin} presented a certificate this machine rejected (${certificate}).`);
  }
  if (Cause.isTimeoutError(error)) {
    return unreachable(`${origin} did not answer within ${Duration.toSeconds(timeout)} seconds.`);
  }
  if (HttpClientError.isHttpClientError(error) && error.reason._tag === "TransportError") {
    const code = connectionCode(error.reason.cause);
    return unreachable(
      code === undefined ? `${origin} did not answer.` : `${origin} did not answer (${code}).`,
    );
  }
  return new PeerLinkError({
    reason: "not_a_supaterm_environment",
    message: `${origin} answered, but not as a Supaterm environment this version understands.`,
  });
};

/** Whether a host is this machine's own loopback. Tests serve their peers there, so they narrow it. */
export const LoopbackHost = Context.Reference<(host: string) => boolean>(
  "supaterm/peer/PeerLinks/LoopbackHost",
  { defaultValue: () => isLocalLoopbackHost },
);

/** Whether a peer holds a linked agent to its limits and keeps its work within its link. */
const linkLimitsHold = (peer: { readonly capabilities: ExecutionEnvironmentCapabilities }) =>
  peer.capabilities.mcpModeLimitHeader === true && peer.capabilities.linkFence === true;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const random = yield* SecureRandom.SecureRandom;
  const digest = yield* Digest.Digest;
  const httpClient = yield* HttpClient.HttpClient;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const isOwnLoopback = yield* LoopbackHost;
  const relay = yield* RelayCompanion.RelayCompanion;

  /** A fresh name for one link's token; the row records it. */
  const newSecretName = random.randomBytes(16).pipe(
    Effect.map((bytes) => `peer-link-${Hex.encode(bytes)}`),
    Effect.orDie,
  );

  // Only the origin `peerOrigin` checked may receive a pairing code or token:
  // a redirect could forward them anywhere, including plain http.
  const peerHttpClient = HttpClient.transform(httpClient, (response) =>
    Effect.provideService(response, FetchHttpClient.RequestInit, { redirect: "manual" }),
  );

  const clientFor = (origin: string) =>
    HttpApiClient.make(PeerHttpApi, { baseUrl: origin }).pipe(
      Effect.provideService(HttpClient.HttpClient, peerHttpClient),
    );

  /** Where requests to `address` go: itself, or this server's tunnel to a relay address. */
  const reach = (address: string, relayUrl: string | undefined) =>
    isRelayAddress(address)
      ? relay.open(address, RELAY_LEASE_OWNER, relayUrl).pipe(
          Effect.mapError(
            () =>
              new PeerLinkError({
                reason: "unreachable",
                message: `${address} did not answer through the relay.`,
              }),
          ),
        )
      : Effect.succeed(address);

  /** The environment answering at `address`, or why nothing there answers as Supaterm. */
  const probe = (address: string, relayUrl: string | undefined) => {
    const timeout = probeTimeout(address);
    return reach(address, relayUrl).pipe(
      Effect.flatMap(clientFor),
      Effect.flatMap((client) => client.metadata.descriptor()),
      // A brief network drop must not list a live peer as down; the timeout still bounds both tries.
      Effect.retry({
        times: 1,
        schedule: Schedule.spaced("1 second"),
        while: (error) => certificateErrorCode(error) === undefined,
      }),
      Effect.timeout(timeout),
      // No cause: a decode error can carry the response body to the client.
      Effect.mapError((error) =>
        error._tag === "PeerLinkError" ? error : probeFailure(address, error, timeout),
      ),
    );
  };

  /** Whether `url` answers as `environmentId`, counting any failure as no. */
  const answersAs = Effect.fn("PeerLinks.answersAs")(function* (
    url: string,
    environmentId: EnvironmentId,
    relayUrl: string | undefined,
  ) {
    const found = yield* probe(url, relayUrl).pipe(Effect.option);
    return Option.filter(found, (peer) => peer.environmentId === environmentId);
  });

  const toLink = Effect.fn("PeerLinks.toLink")(function* (row: PeerLinkRow) {
    return {
      environmentId: EnvironmentId.make(row.environment_id),
      label: row.label,
      urls: yield* decodeUrls(row.urls_json),
      access: yield* decodeAccess(row.access),
      linkedAt: DateTime.makeUnsafe(row.linked_at),
      expiresAt: DateTime.makeUnsafe(row.expires_at),
      lastReachedAt: row.last_reached_at === null ? null : DateTime.makeUnsafe(row.last_reached_at),
      lastError: row.last_error,
      ...(row.relay_url === null ? {} : { relayUrl: row.relay_url }),
    } satisfies PeerLink;
  }, Effect.catch(failStorage));

  const readRows = sql<PeerLinkRow>`
    SELECT * FROM peer_environment_links ORDER BY label, environment_id
  `.pipe(NodeSqliteClient.readOnly, Effect.catch(failStorage));

  const readRow = (environmentId: EnvironmentId) =>
    sql<PeerLinkRow>`
      SELECT * FROM peer_environment_links WHERE environment_id = ${environmentId}
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.catch(failStorage),
      Effect.map((rows) => Option.fromNullishOr(rows[0])),
    );

  /** Closes tunnels to relay addresses no stored link uses. */
  const releaseUnlinked = Effect.fn("PeerLinks.releaseUnlinked")(
    function* (addresses: ReadonlyArray<string>) {
      const relayAddresses = addresses.filter(isRelayAddress);
      if (relayAddresses.length === 0) return;
      const linked = new Set(
        (yield* Effect.forEach(yield* readRows, (row) => decodeUrls(row.urls_json))).flat(),
      );
      yield* Effect.forEach(
        relayAddresses.filter((address) => !linked.has(address)),
        (address) => relay.close(address, RELAY_LEASE_OWNER),
        { discard: true },
      );
    },
    Effect.ignore({ log: true }),
  );

  /** Signs in to the peer's `/mcp` with a pairing code: register, decide, exchange. */
  const signIn = Effect.fn("PeerLinks.signIn")(
    function* (origin: string, input: PeerLinkCreateInput, clientName: string) {
      const client = yield* clientFor(origin);
      // Only the peer's own refusals are rejections. A dropped connection or
      // an answer this version cannot read is classified below.
      const registered = yield* client.mcpOAuth
        .register({
          payload: {
            client_name: clientName,
            redirect_uris: [LINK_REDIRECT_URI],
            software_id: MCP_PEER_LINK_SOFTWARE_ID,
          },
        })
        .pipe(
          // A plain Schema.Error has no tag to catch by.
          Effect.catchIf(Schema.is(AuthMcpRegistrationError), (error) =>
            Effect.fail(
              new PeerLinkError({
                reason: "pairing_rejected",
                message: `The peer refused to register this environment: ${error.message}`,
              }),
            ),
          ),
        );
      const verifier = Base64Url.encode(yield* random.randomBytes(32));
      const challenge = Base64Url.encode(
        yield* digest.digest(Digest.sha256, new TextEncoder().encode(verifier)).pipe(Effect.orDie),
      );
      const state = Base64Url.encode(yield* random.randomBytes(16));
      const resource = `${origin}/mcp`;
      const decided = yield* client.mcpOAuth
        .decision({
          payload: {
            authorization: {
              response_type: "code",
              client_id: registered.client_id,
              redirect_uri: LINK_REDIRECT_URI,
              code_challenge: challenge,
              code_challenge_method: "S256",
              state: Redacted.make(state),
              resource,
            },
            decision: { _tag: "pairing-code", access: input.access, code: input.pairingCode },
          },
        })
        .pipe(
          Effect.catchTags({
            AuthMcpApprovalError: (error) =>
              Effect.fail(
                new PeerLinkError({ reason: "pairing_rejected", message: error.message }),
              ),
          }),
        );
      const redirect = URL.parse(decided.redirectTo);
      if (redirect === null) {
        return yield* new PeerLinkError({
          reason: "incompatible",
          message: `${origin} answered the sign-in with an address this version cannot read. Update both environments.`,
        });
      }
      const code = redirect.searchParams.get("code");
      if (code === null || redirect.searchParams.get("state") !== state) {
        return yield* new PeerLinkError({
          reason: "pairing_rejected",
          message:
            redirect.searchParams.get("error_description") ??
            "The peer did not approve the link. Check the pairing code and try again.",
        });
      }
      return yield* client.mcpOAuth
        .token({
          payload: {
            grant_type: "authorization_code",
            code: Redacted.make(code),
            redirect_uri: LINK_REDIRECT_URI,
            client_id: registered.client_id,
            code_verifier: Redacted.make(verifier),
            resource,
          },
        })
        .pipe(
          Effect.catchIf(Schema.is(AuthMcpTokenError), (error) =>
            Effect.fail(
              new PeerLinkError({
                reason: "pairing_rejected",
                message: `The peer refused the sign-in: ${error.message}`,
              }),
            ),
          ),
        );
    },
    (effect, origin, input) =>
      effect.pipe(
        // Endpoint errors are mapped above; what is left is the transport or an
        // answer this version cannot decode.
        Effect.catchTags({
          SchemaError: (cause) =>
            Effect.fail(
              new PeerLinkError({
                reason: "incompatible",
                message: `${origin} answered in a shape this version does not understand. Update both environments.`,
                cause,
              }),
            ),
          HttpClientError: (cause) =>
            Effect.fail(
              new PeerLinkError({
                reason: "unreachable",
                message: `${origin} stopped answering while linking.`,
                cause,
              }),
            ),
        }),
        // A refusal can quote what the peer was sent, and its words go on to the card and the
        // agent, so the pairing code is taken out of them here.
        Effect.mapError((error) =>
          input.pairingCode.length > 0 && error.message.includes(input.pairingCode)
            ? new PeerLinkError({
                reason: error.reason,
                message: error.message.replaceAll(input.pairingCode, "(the pairing code)"),
              })
            : error,
        ),
      ),
  );

  /**
   * The addresses that answer as `environmentId`, in the order given, with
   * what the first one answered. Addresses this environment would not send
   * credentials to are skipped; when none answers as it, the failure says why
   * for each.
   */
  const answeringAs = Effect.fn("PeerLinks.answeringAs")(function* (
    urls: ReadonlyArray<string>,
    environmentId: EnvironmentId,
    name: string,
    relayUrl: string | undefined,
  ) {
    const checked = yield* Effect.forEach(
      urls,
      (url) =>
        Effect.gen(function* () {
          const origin = yield* peerOrigin(url);
          // Loopback is this machine, where anything may answer as the one picked.
          if (!isRelayAddress(origin) && isOwnLoopback(new URL(origin).hostname)) {
            return yield* new PeerLinkError({
              reason: "unreachable",
              message: `${origin} is this machine, not ${name}.`,
            });
          }
          const descriptor = yield* probe(origin, relayUrl);
          if (descriptor.environmentId !== environmentId) {
            return yield* new PeerLinkError({
              reason: "unreachable",
              message: `${origin} answered as another environment, ${descriptor.label}.`,
            });
          }
          return { origin, descriptor };
        }).pipe(Effect.result),
      { concurrency: "unbounded" },
    );
    const matching = checked.flatMap((result) =>
      Result.isSuccess(result) ? [result.success] : [],
    );
    const first = matching[0];
    if (first === undefined) {
      const reasons = checked.flatMap((result) =>
        Result.isFailure(result) ? [result.failure.message] : [],
      );
      return yield* new PeerLinkError({
        reason: "unreachable",
        message: `This environment could not reach ${name}: ${reasons.join(" ")}`,
      });
    }
    // Each address is kept once, even when two spellings share an origin.
    const origins = [...new Set(matching.map((found) => found.origin))];
    return { primary: first.origin, peer: first.descriptor, origins };
  });

  /** The peer at `url`, with every address checked for credentials first. */
  const answeringAt = Effect.fn("PeerLinks.answeringAt")(function* (
    urls: ReadonlyArray<string>,
    relayUrl: string | undefined,
  ) {
    const origins = yield* Effect.forEach(urls, peerOrigin);
    const primary = origins[0]!;
    return { primary, peer: yield* probe(primary, relayUrl), origins };
  });

  const linkAt = Effect.fn("PeerLinks.linkAt")(function* (
    input: PeerLinkCreateInput,
    urls: ReadonlyArray<string>,
  ) {
    // The user picked a machine: link through the addresses that answer as
    // it, so one that now answers as another never receives the pairing code.
    const { primary, peer, origins } =
      input.expectedEnvironmentId === undefined
        ? yield* answeringAt(urls, input.relayUrl)
        : yield* answeringAs(
            urls,
            input.expectedEnvironmentId,
            input.expectedLabel ?? input.expectedEnvironmentId,
            input.relayUrl,
          );
    // Anything can answer as a linked machine, so an address alone renews its
    // link only where the link already reaches it, and never moves it.
    if (input.expectedEnvironmentId === undefined) {
      const row = yield* readRow(peer.environmentId);
      const existing = Option.isSome(row) ? yield* toLink(row.value) : undefined;
      if (
        existing !== undefined &&
        DateTime.isGreaterThan(existing.expiresAt, yield* DateTime.now) &&
        !existing.urls.includes(primary)
      ) {
        return yield* new PeerLinkError({
          reason: "pairing_rejected",
          message: `${primary} answers as ${existing.label}, which is already linked at another address. If ${existing.label} moved, forget that link first.`,
        });
      }
    }
    const self = yield* environment.getDescriptor;
    if (peer.environmentId === self.environmentId) {
      return yield* new PeerLinkError({
        reason: "self",
        message: "That address is this environment.",
      });
    }
    if (!linkLimitsHold(peer)) {
      return yield* new PeerLinkError({
        reason: "incompatible",
        message: `${peer.label} runs a Supaterm version that cannot keep a linked agent's limits. Update it, then link again.`,
      });
    }
    const issued = yield* signIn(
      yield* reach(primary, input.relayUrl),
      input,
      `${LINK_CLIENT_NAME_PREFIX}${self.label}`,
    );
    const relayUrl = origins.some(isRelayAddress) ? input.relayUrl : undefined;
    const now = yield* DateTime.now;
    const linked: PeerLink = {
      environmentId: peer.environmentId,
      label: peer.label,
      urls: origins,
      access: input.access,
      linkedAt: now,
      expiresAt: DateTime.add(now, { seconds: issued.expires_in }),
      lastReachedAt: now,
      lastError: null,
      ...(relayUrl === undefined ? {} : { relayUrl }),
    };
    // The token goes under a name of its own before the row points at it,
    // so the row and its token are replaced together.
    const secretName = yield* newSecretName;
    yield* secrets
      .set(secretName, new TextEncoder().encode(issued.access_token))
      .pipe(Effect.catch(failStorage));
    // A token no row names could never be removed.
    const previous = yield* Effect.gen(function* () {
      const urlsJson = yield* encodeUrls(origins).pipe(Effect.catch(failStorage));
      const previous = yield* readRow(peer.environmentId);
      yield* sql`
        INSERT INTO peer_environment_links (
          environment_id, secret_name, label, urls_json, access, linked_at, expires_at,
          last_reached_at, last_error, relay_url
        ) VALUES (
          ${linked.environmentId}, ${secretName}, ${linked.label}, ${urlsJson}, ${linked.access},
          ${DateTime.formatIso(linked.linkedAt)}, ${DateTime.formatIso(linked.expiresAt)},
          ${DateTime.formatIso(now)}, NULL, ${relayUrl ?? null}
        )
        ON CONFLICT (environment_id) DO UPDATE SET
          secret_name = excluded.secret_name,
          relay_url = excluded.relay_url,
          label = excluded.label,
          urls_json = excluded.urls_json,
          access = excluded.access,
          linked_at = excluded.linked_at,
          expires_at = excluded.expires_at,
          last_reached_at = excluded.last_reached_at,
          last_error = NULL
      `.pipe(Effect.catch(failStorage));
      return previous;
    }).pipe(Effect.onError(() => secrets.remove(secretName).pipe(Effect.ignore)));
    // Linking again replaces the old token. A racing link may leave its own
    // behind; it is unused either way.
    if (Option.isSome(previous) && previous.value.secret_name !== secretName) {
      yield* secrets.remove(previous.value.secret_name).pipe(Effect.ignore);
    }
    // A relay address the link no longer names would keep its tunnel until a restart.
    if (Option.isSome(previous)) {
      yield* decodeUrls(previous.value.urls_json).pipe(
        Effect.flatMap(releaseUnlinked),
        Effect.ignore,
      );
    }
    return linked;
  });

  const link: PeerLinks["Service"]["link"] = Effect.fn("PeerLinks.link")(function* (input) {
    const urls = [input.url, ...(input.alternateUrls ?? [])];
    // A tunnel opened for an address that never became a link has no one to close it.
    return yield* linkAt(input, urls).pipe(
      Effect.ensuring(releaseUnlinked(urls.flatMap((url) => relayAddressOf(url) ?? []))),
    );
  });

  /** A peer's label follows its machine name, so the link takes the one its own address answers with. */
  const withLabel = (link: PeerLink, label: string) =>
    label === link.label
      ? Effect.succeed(link)
      : sql`
          UPDATE peer_environment_links SET label = ${label}
          WHERE environment_id = ${link.environmentId}
        `.pipe(Effect.ignoreCause({ log: true }), Effect.as({ ...link, label }));

  const statusOf = Effect.fn("PeerLinks.statusOf")(function* (
    link: PeerLink,
    now: DateTime.Utc,
  ): Effect.fn.Return<PeerLinkSummary> {
    if (DateTime.isLessThanOrEqualTo(link.expiresAt, now)) return { ...link, status: "expired" };
    // A race over no addresses never settles.
    if (link.urls.length === 0) return { ...link, status: "unreachable" };
    const answered = yield* Effect.raceAll(
      link.urls.map((url) =>
        answersAs(url, link.environmentId, link.relayUrl).pipe(Effect.flatMap(Effect.fromOption)),
      ),
    ).pipe(Effect.timeoutOption(LIST_PROBE_TIMEOUT), Effect.orElseSucceed(Option.none));
    if (Option.isNone(answered)) return { ...link, status: "unreachable" };
    return { ...(yield* withLabel(link, answered.value.label)), status: "reachable" };
  });

  const list: PeerLinks["Service"]["list"] = Effect.gen(function* () {
    const links = yield* Effect.forEach(yield* readRows, toLink);
    const now = yield* DateTime.now;
    return yield* Effect.forEach(links, (link) => statusOf(link, now), {
      concurrency: "unbounded",
    });
  });

  const get: PeerLinks["Service"]["get"] = (environmentId) =>
    readRow(environmentId).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeedNone,
          onSome: (row) => Effect.asSome(toLink(row)),
        }),
      ),
    );

  const unlink: PeerLinks["Service"]["unlink"] = Effect.fn("PeerLinks.unlink")(
    function* (environmentId) {
      const deleted = yield* sql<{ secret_name: string; urls_json: string }>`
        DELETE FROM peer_environment_links WHERE environment_id = ${environmentId}
        RETURNING secret_name, urls_json
      `.pipe(Effect.catch(failStorage));
      for (const row of deleted) {
        yield* secrets.remove(row.secret_name).pipe(Effect.catch(failStorage));
        yield* decodeUrls(row.urls_json).pipe(Effect.flatMap(releaseUnlinked), Effect.ignore);
      }
      return deleted.length > 0;
    },
  );

  const unlinkAll: PeerLinks["Service"]["unlinkAll"] = readRows.pipe(
    Effect.flatMap((rows) =>
      Effect.forEach(rows, (row) => unlink(EnvironmentId.make(row.environment_id))),
    ),
    Effect.map((forgotten) => forgotten.filter(Boolean).length),
    Effect.withSpan("PeerLinks.unlinkAll"),
  );

  const resolve: PeerLinks["Service"]["resolve"] = Effect.fn("PeerLinks.resolve")(
    function* (environmentId, options) {
      const notLinked = new PeerLinkError({
        reason: "unknown_link",
        message: `This environment is not linked to ${environmentId}. supaterm_environment_links lists the linked ones.`,
      });
      const row = yield* readRow(environmentId);
      if (Option.isNone(row)) return yield* notLinked;
      const link = yield* toLink(row.value);
      if (
        options?.linkedAt !== undefined &&
        DateTime.formatIso(link.linkedAt) !== options.linkedAt
      ) {
        return yield* new PeerLinkError({
          reason: "unknown_link",
          message: `The link to ${link.label} was made again since this was first sent, so it is not sent under the new link.`,
        });
      }
      if (DateTime.isLessThanOrEqualTo(link.expiresAt, yield* DateTime.now)) {
        return yield* new PeerLinkError({
          reason: "expired",
          message: `The link to ${link.label} expired. Link it again with a new pairing code from ${link.label}.`,
        });
      }
      const stored = yield* secrets.get(row.value.secret_name).pipe(Effect.catch(failStorage));
      if (Option.isNone(stored)) {
        // An unlink between the two reads removes the row before its secret.
        if (Option.isNone(yield* readRow(environmentId))) return yield* notLinked;
        return yield* new PeerLinkError({
          reason: "unknown_link",
          message: `The link to ${link.label} lost its credential. Link it again.`,
        });
      }
      // The token goes only to an address that still answers as this peer,
      // so one that now answers as another machine never receives it. The
      // addresses race, so a silent one never delays one that answers.
      const answered =
        link.urls.length === 0
          ? Option.none()
          : yield* Effect.raceAll(
              link.urls.map((url) =>
                answersAs(url, environmentId, link.relayUrl).pipe(
                  Effect.flatMap(Effect.fromOption),
                  Effect.map((peer) => ({ address: url, peer })),
                ),
              ),
            ).pipe(Effect.option);
      if (Option.isNone(answered)) {
        return yield* new PeerLinkError({
          reason: "unreachable",
          message: `${link.label} did not answer at ${link.urls.join(", ")}.`,
        });
      }
      const { address, peer } = answered.value;
      // A link made before the peer had to fence linked work, or a peer moved
      // back to such a version, would carry work past those limits.
      if (!linkLimitsHold(peer)) {
        return yield* new PeerLinkError({
          reason: "incompatible",
          message: `${link.label} runs a Supaterm version that cannot keep a linked agent's limits. Update it, then link again.`,
        });
      }
      return {
        link: yield* withLabel(link, peer.label),
        address,
        url: yield* reach(address, link.relayUrl),
        token: new TextDecoder().decode(stored.value),
      };
    },
  );

  const recordOutcome: PeerLinks["Service"]["recordOutcome"] = (environmentId, outcome) =>
    DateTime.now.pipe(
      Effect.flatMap((now) =>
        outcome.error === null
          ? sql`
              UPDATE peer_environment_links
              SET last_reached_at = ${DateTime.formatIso(now)}, last_error = NULL
              WHERE environment_id = ${environmentId}
            `
          : sql`
              UPDATE peer_environment_links SET last_error = ${outcome.error}
              WHERE environment_id = ${environmentId}
            `,
      ),
      Effect.asVoid,
      Effect.ignoreCause({ log: true }),
    );

  return PeerLinks.of({
    link,
    list,
    get,
    unlink,
    unlinkAll,
    resolve,
    recordOutcome,
  });
});

export const layer = Layer.effect(PeerLinks, make);
