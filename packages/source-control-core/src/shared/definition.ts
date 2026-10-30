import {
  type PullRequestAction,
  type SourceControlAppSignIn,
  type PullRequestListedAction,
  type PullRequestReviewVerdict,
  type RepositoryIdentity,
  secretSetting,
  SourceControlProviderKind,
  type SourceControlProviderInfo,
  TrimmedNonEmptyString,
  TrimmedString,
} from "@supaterm/contracts";
import { normalizeGitRemoteUrl, parseGitRemoteRepository } from "@supaterm/shared/git";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

export interface ChangeRequestLink {
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly authority?: string;
}

export interface ParsedChangeRequestUrl extends ChangeRequestLink {
  readonly repositoryUrl: string;
}

export interface ChangeRequestTerminology {
  readonly shortLabel: string;

  readonly shortLabelWithArticle: string;
  readonly singular: string;
  readonly plural: string;
}

export interface ChangeRequestUrlInput {
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly remoteUrl?: string | undefined;

  readonly webUrl?: string | undefined;
}

export type ChangeRequestProjectIdentity = Pick<
  RepositoryIdentity,
  "canonicalKey" | "locator" | "webUrl" | "displayName" | "owner" | "name"
>;

export type ChangeRequestHostIdentity =
  | {
      readonly canonicalKey?: string | undefined;
      readonly locator?: { readonly remoteUrl: string } | undefined;
    }
  | null
  | undefined;

export type RepositorySelectorIdentity = Pick<
  RepositoryIdentity,
  "provider" | "displayName" | "owner" | "name"
>;

export interface GitRemoteHost {
  readonly remoteUrl: string;

  readonly host: string;

  readonly hostname: string;
}

export interface ChangeRequestCheckoutInput {
  readonly number: number;
  readonly headBranch: string;
  readonly headRepositoryNameWithOwner?: string | null | undefined;
  readonly repositoryUrl?: string | null | undefined;
}

export interface SourceControlMediaUrl {
  readonly fetchUrl: string;

  readonly fileName: string;

  readonly kind?: "image" | "video";
}

export interface ReferenceAutolink {
  readonly index: number;
  readonly text: string;

  readonly label: string;
  readonly url: string;
  readonly kind: "reference" | "commit" | "mention";
}

export interface SourceControlHostCredentials {
  readonly cliName: string;

  readonly cliLabel: string;
  readonly loginCommand: string;

  readonly tokenEnvVar: string;

  readonly tokenAccess: string;
  readonly newTokenUrl: (host: string) => string;

  readonly appSignIn?: SourceControlAppSignIn;
}

export const SourceControlHostName = TrimmedNonEmptyString.pipe(
  Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()),
);

export const HostAccountChoice = Schema.Struct({
  account: Schema.optionalKey(TrimmedNonEmptyString),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type HostAccountChoice = typeof HostAccountChoice.Type;

export const hostCredentialSettingsFields = {
  hosts: Schema.Record(SourceControlHostName, HostAccountChoice).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
    Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
  ),
  tokens: Schema.Record(SourceControlHostName, TrimmedString).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
    secretSetting,
    Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
  ),

  signIns: Schema.Record(SourceControlHostName, TrimmedString).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
    secretSetting,
    Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
  ),
};

export const HostCredentialSettings = Schema.Struct(hostCredentialSettingsFields);
export type HostCredentialSettings = typeof HostCredentialSettings.Type;

export interface SourceControlDefinition {
  readonly kind: SourceControlProviderKind;
  readonly label: string;
  readonly pickerLabel: string;

  readonly searchKeywords?: ReadonlyArray<string>;
  readonly credentials?: SourceControlHostCredentials;
  readonly changeRequest: ChangeRequestTerminology;
  readonly repositoryPathHint: string;
  readonly publicHost: string | null;
  readonly publishDescription: string;
  readonly publishHost: (signedInHost: string | null) => string;
  readonly newRepositoryOwner: (account: string | null) => { readonly owner: string | null } | null;
  readonly defaultCloneTransport: "https" | "ssh";
  readonly changeRequestUrl: (input: ChangeRequestUrlInput) => string | null;

  readonly parseChangeRequestUrl: (url: URL) => ParsedChangeRequestUrl | null;

  readonly changeRequestUrlFromReferenceAutolink: (url: URL) => string | null;
  /**
   * The actions this host can take on a change request, the same list its server provider
   * declares in `capabilities.actions`.
   */
  readonly changeRequestActions: ReadonlySet<PullRequestListedAction>;
  readonly checkoutCommand: (changeRequest: ChangeRequestCheckoutInput) => string | null;

  readonly changeRequestCloseCommand?: RegExp;

  readonly changeRequestCreateCommand?: RegExp;
  readonly authorProfileUrl: (login: string, repositoryUrl: string) => string | null;

  readonly referenceAutolinks?: (
    text: string,
    repositoryUrl: string,
  ) => ReadonlyArray<ReferenceAutolink>;

  readonly changeRequestChecksUrl?: (changeRequestUrl: string) => string;

  readonly changeRequestActionsWhenUnreported?: ReadonlySet<PullRequestAction>;

  readonly changeRequestListScope?: "host" | "repository";
  readonly reviewSummaryRequired: (verdict: PullRequestReviewVerdict) => boolean;
  readonly checkoutCommandArgument: (input: string) => string | null;
  readonly isChangeRequestReference: (url: string) => boolean;
  readonly isChangeRequestInRepository: (
    identity: ChangeRequestProjectIdentity,
    link: ChangeRequestLink,
  ) => boolean;
  readonly canReadChangeRequestOnHost: (
    identity: ChangeRequestProjectIdentity,
    link: ChangeRequestLink,
  ) => boolean;
  readonly checkoutChangeRequestHost: (identity: ChangeRequestProjectIdentity) => string | null;

  readonly changeRequestHeadRef?: (number: number) => string;

  readonly recognizeRemote: (remote: GitRemoteHost) => SourceControlProviderInfo | null;

  readonly changeRequestHost?: (identity: ChangeRequestHostIdentity) => string;

  readonly repositorySelector?: (identity: RepositorySelectorIdentity) => string | null;

  readonly repositoryKeyFromRemote?: (key: string) => string | null;

  readonly canonicalRepositoryKey?: (key: string) => string | null;

  readonly mediaUrl?: (url: URL) => SourceControlMediaUrl | null;
  readonly settings?: SourceControlHostSettingsSchema;
}

export type SourceControlHostSettingsSchema = {
  readonly fields: Readonly<Record<string, Schema.Top>>;
} & Schema.Decoder<object>;

export function parseChangeRequestPath(url: URL, route: RegExp): ParsedChangeRequestUrl | null {
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const match = route.exec(url.pathname);
  const repository = match?.[1];
  const number = Number(match?.[2]);
  return repository && Number.isSafeInteger(number) && number > 0
    ? {
        host: url.hostname.toLowerCase(),
        repository: repository.toLowerCase(),
        number,
        repositoryUrl: `${url.origin}/${repository}`,
      }
    : null;
}

export function changeRequestUrlBelow(webUrl: string, route: string): string {
  return `${webUrl.replace(/\/+$/u, "")}/${route}`;
}

export function remoteWebOrigin(host: string, remoteUrl: string | undefined): string {
  try {
    const remote = new URL(remoteUrl ?? "");
    if (
      (remote.protocol === "http:" || remote.protocol === "https:") &&
      (remote.hostname.toLowerCase() === host.toLowerCase() ||
        remote.host.toLowerCase() === host.toLowerCase())
    ) {
      return remote.origin;
    }
  } catch {}
  return `https://${host}`;
}

export function defineSourceControl<const Definition extends SourceControlDefinition>(
  definition: Definition,
): Definition {
  return definition;
}

export function isChangeRequestAuthorityOfProject(
  identity: ChangeRequestProjectIdentity,
  link: ChangeRequestLink,
): boolean {
  if (link.authority === undefined) return true;
  try {
    const remote = new URL(identity.locator.remoteUrl);
    if (remote.protocol === "http:" || remote.protocol === "https:") {
      return remote.host.toLowerCase() === link.authority;
    }
  } catch {
    // SSH remotes do not specify the server's HTTP port.
  }
  return true;
}

export function projectChangeRequestHost<const Kind extends string | undefined>(
  identity: ChangeRequestHostIdentity,
  kind: Kind,
): string | Kind {
  const host = identity?.canonicalKey?.split("/")[0]?.trim();
  return host === undefined || host.length === 0 ? kind : host.toLowerCase();
}

export function isChangeRequestOnProjectHost(
  projectHost: string,
  identity: ChangeRequestProjectIdentity,
  link: ChangeRequestLink,
): boolean {
  if (!isChangeRequestAuthorityOfProject(identity, link)) return false;
  return projectHost === link.host.toLowerCase() || projectHost === link.authority;
}

function projectRepositoryPath(identity: ChangeRequestProjectIdentity): string | null {
  return (
    identity.displayName ??
    (identity.owner && identity.name ? `${identity.owner}/${identity.name}` : null)
  );
}

export function isChangeRequestInProjectRepository(
  projectHost: string,
  identity: ChangeRequestProjectIdentity,
  link: ChangeRequestLink,
): boolean {
  const repository = projectRepositoryPath(identity);
  return (
    repository !== null &&
    repository.toLowerCase() === link.repository.toLowerCase() &&
    isChangeRequestOnProjectHost(projectHost, identity, link)
  );
}

const SCP_REMOTE = /^[a-zA-Z0-9._-]+@([^:/]+):/;

export function parseGitRemoteHost(remoteUrl: string): GitRemoteHost | null {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) return null;
  let host: string;
  const scpHost = SCP_REMOTE.exec(trimmed)?.[1];
  if (scpHost) {
    host = scpHost.toLowerCase();
  } else {
    try {
      const url = new URL(trimmed);
      host = (url.protocol === "ssh:" ? url.hostname : url.host).toLowerCase();
    } catch {
      return null;
    }
  }
  if (host.length === 0) return null;
  let hostname: string;
  try {
    hostname = new URL(`https://${host}`).hostname.toLowerCase();
  } catch {
    hostname = host.replace(/:\d+$/u, "").toLowerCase();
  }
  return { remoteUrl: trimmed, host, hostname };
}

export function unknownRemoteProvider(remote: GitRemoteHost): SourceControlProviderInfo {
  return {
    kind: SourceControlProviderKind.make("unknown"),
    name: remote.host,
    baseUrl: `https://${remote.host}`,
  };
}

export function recognizeRemoteWith(
  definition: Pick<SourceControlDefinition, "recognizeRemote">,
  remoteUrl: string,
): SourceControlProviderInfo | null {
  const remote = parseGitRemoteHost(remoteUrl);
  return remote === null ? null : definition.recognizeRemote(remote);
}

function defaultRepositorySelector(
  identity: RepositorySelectorIdentity | null | undefined,
): string | null {
  if (!identity) return null;
  if (identity.displayName) return identity.displayName;
  return identity.owner && identity.name ? `${identity.owner}/${identity.name}` : null;
}

export const UNKNOWN_SOURCE_CONTROL_CLIENT: SourceControlDefinition = {
  kind: SourceControlProviderKind.make("unknown"),
  label: "source control",
  pickerLabel: "source control",
  changeRequest: {
    shortLabel: "change request",
    shortLabelWithArticle: "a change request",
    singular: "change request",
    plural: "change requests",
  },
  repositoryPathHint: "URL",
  publicHost: null,
  publishDescription: "Your signed-in server",
  publishHost: (signedInHost) => signedInHost ?? "your server",
  newRepositoryOwner: () => null,
  defaultCloneTransport: "ssh",
  changeRequestUrl: () => null,
  parseChangeRequestUrl: () => null,
  changeRequestUrlFromReferenceAutolink: () => null,
  changeRequestActions: new Set(),
  checkoutCommand: () => null,
  authorProfileUrl: () => null,
  reviewSummaryRequired: () => false,
  checkoutCommandArgument: () => null,
  isChangeRequestReference: () => false,
  checkoutChangeRequestHost: () => null,
  recognizeRemote: () => null,
  isChangeRequestInRepository: (identity, link) =>
    isChangeRequestInProjectRepository(
      projectChangeRequestHost(identity, "unknown"),
      identity,
      link,
    ),
  canReadChangeRequestOnHost: (identity, link) =>
    isChangeRequestOnProjectHost(projectChangeRequestHost(identity, "unknown"), identity, link),
};

export interface ParsedChangeRequest {
  readonly definition: SourceControlDefinition;
  readonly link: ParsedChangeRequestUrl;
}

export interface SourceControlMedia extends SourceControlMediaUrl {
  readonly definition: SourceControlDefinition;
}

export interface SourceControlDefinitionRegistry {
  readonly definitions: ReadonlyArray<SourceControlDefinition>;
  readonly get: (kind: string | null | undefined) => SourceControlDefinition;
  readonly find: (kind: string) => SourceControlDefinition | undefined;
  readonly findByPublicHost: (hostname: string) => SourceControlDefinition | undefined;

  readonly findByPublicDomain: (hostname: string) => SourceControlDefinition | undefined;

  readonly parseChangeRequestUrl: (url: string) => ParsedChangeRequest | null;
  readonly findByChangeRequestUrl: (url: string) => SourceControlDefinition | undefined;
  readonly hostLabelForChangeRequestUrl: (url: string) => string;
  readonly isSameChangeRequest: (left: string, right: string) => boolean;
  readonly changeRequestUrlFromReferenceAutolink: (url: string) => string | null;

  readonly recognizeRemote: (remoteUrl: string) => SourceControlProviderInfo | null;

  readonly repositoryKeyFromRemote: (remoteUrl: string) => string;
  readonly canonicalRepositoryKey: (key: string) => string;

  readonly findByRepositoryKey: (key: string) => SourceControlDefinition | undefined;
  readonly repositorySelector: (
    identity: RepositorySelectorIdentity | null | undefined,
  ) => string | null;
  readonly changeRequestHost: <const Kind extends string | undefined>(
    identity: ChangeRequestHostIdentity,
    kind: Kind,
  ) => string | Kind;

  readonly mediaUrl: (url: string) => SourceControlMedia | null;
}

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function inOrder(
  definitions: ReadonlyArray<SourceControlDefinition>,
  firstKinds: ReadonlyArray<SourceControlProviderKind> | undefined,
): ReadonlyArray<SourceControlDefinition> {
  const first = (firstKinds ?? []).flatMap(
    (kind) => definitions.find((definition) => definition.kind === kind) ?? [],
  );
  return [...first, ...definitions.filter((definition) => !first.includes(definition))];
}

export function makeSourceControlDefinitionRegistry(
  definitions: ReadonlyArray<SourceControlDefinition>,
  options?: {
    readonly claimChangeRequestUrlsFirst?: ReadonlyArray<SourceControlProviderKind>;
    readonly recognizeRemotesIn?: ReadonlyArray<SourceControlProviderKind>;
  },
): SourceControlDefinitionRegistry {
  const byKind = new Map<string, SourceControlDefinition>();
  for (const definition of definitions) {
    if (byKind.has(definition.kind)) {
      throw new Error(`Source control host '${definition.kind}' is defined more than once.`);
    }
    byKind.set(definition.kind, definition);
  }
  const claimOrder = inOrder(definitions, options?.claimChangeRequestUrlsFirst);
  const recognitionOrder = inOrder(definitions, options?.recognizeRemotesIn);
  const repositoryKeyOwner = (key: string) => {
    for (const definition of definitions) {
      const canonical = definition.canonicalRepositoryKey?.(key);
      if (canonical != null) return { definition, canonical };
    }
    return undefined;
  };
  const parseChangeRequestUrl = (value: string): ParsedChangeRequest | null => {
    const url = httpUrl(value);
    if (url === null) return null;
    for (const definition of claimOrder) {
      const link = definition.parseChangeRequestUrl(url);
      if (link !== null) return { definition, link };
    }
    return null;
  };
  return {
    definitions,
    get: (kind) =>
      (kind == null ? definitions[0] : byKind.get(kind)) ?? UNKNOWN_SOURCE_CONTROL_CLIENT,
    find: (kind) => byKind.get(kind),
    findByPublicHost: (hostname) => {
      const host = hostname.toLowerCase();
      return definitions.find((definition) => definition.publicHost === host);
    },
    findByPublicDomain: (hostname) => {
      const host = hostname.toLowerCase();
      return definitions.find(
        (definition) =>
          definition.publicHost !== null &&
          (host === definition.publicHost || host.endsWith(`.${definition.publicHost}`)),
      );
    },
    parseChangeRequestUrl,
    findByChangeRequestUrl: (url) => parseChangeRequestUrl(url)?.definition,
    hostLabelForChangeRequestUrl: (url) =>
      parseChangeRequestUrl(url)?.definition.label ?? "the host",
    isSameChangeRequest: (left, right) => {
      const a = parseChangeRequestUrl(left)?.link;
      const b = parseChangeRequestUrl(right)?.link;
      return (
        a !== undefined &&
        b !== undefined &&
        a.host === b.host &&
        a.repository === b.repository &&
        a.number === b.number &&
        a.authority === b.authority
      );
    },
    changeRequestUrlFromReferenceAutolink: (value) => {
      const url = httpUrl(value);
      if (url === null) return null;
      for (const definition of claimOrder) {
        const candidate = definition.changeRequestUrlFromReferenceAutolink(url);
        if (candidate !== null) return candidate;
      }
      return null;
    },
    recognizeRemote: (remoteUrl) => {
      const remote = parseGitRemoteHost(remoteUrl);
      if (remote === null) return null;
      for (const definition of recognitionOrder) {
        const provider = definition.recognizeRemote(remote);
        if (provider !== null) return provider;
      }
      return unknownRemoteProvider(remote);
    },
    repositoryKeyFromRemote: (remoteUrl) => {
      const key = normalizeGitRemoteUrl(remoteUrl);
      if (parseGitRemoteRepository(remoteUrl) === null) return key;
      for (const definition of definitions) {
        const spelled = definition.repositoryKeyFromRemote?.(key);
        if (spelled != null) return spelled;
      }
      return key;
    },
    canonicalRepositoryKey: (key) => repositoryKeyOwner(key)?.canonical ?? key,
    findByRepositoryKey: (key) => repositoryKeyOwner(key)?.definition,
    repositorySelector: (identity) =>
      identity?.provider === undefined
        ? defaultRepositorySelector(identity)
        : (byKind.get(identity.provider)?.repositorySelector ?? defaultRepositorySelector)(
            identity,
          ),
    changeRequestHost: (identity, kind) =>
      (kind === undefined ? undefined : byKind.get(kind)?.changeRequestHost?.(identity)) ??
      projectChangeRequestHost(identity, kind),
    mediaUrl: (value) => {
      const url = httpUrl(value);
      if (url === null) return null;
      for (const definition of definitions) {
        const media = definition.mediaUrl?.(url);
        if (media != null) return { ...media, definition };
      }
      return null;
    },
  };
}

export function readSourceControlHostSettings<S extends SourceControlHostSettingsSchema>(
  schema: S,
  saved: unknown,
): S["Type"] {
  const decode = Schema.decodeUnknownOption(schema as Schema.Decoder<S["Type"]>);
  const decoded = decode(saved ?? {});
  if (decoded._tag === "Some") return decoded.value;
  const fallback = decode({});
  if (fallback._tag === "Some") return fallback.value;
  throw new Error("A source control host settings schema must decode an empty object.");
}
