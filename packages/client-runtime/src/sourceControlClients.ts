import { builtInSourceControlDefinitions } from "@supaterm/source-control-definitions/registry";
import {
  HostCredentialSettings,
  readSourceControlHostSettings,
  type SourceControlDefinition,
} from "@supaterm/source-control-core/shared/definition";
import type {
  ServerSettings,
  SourceControlAppAccessInput,
  SourceControlAppSignIn,
  SourceControlProviderDiscoveryItem,
} from "@supaterm/contracts";
import { parseGitRemoteRepository } from "@supaterm/shared/git";

export {
  UNKNOWN_SOURCE_CONTROL_CLIENT,
  type ChangeRequestLink,
  type ChangeRequestTerminology,
  type HostAccountChoice,
  type HostCredentialSettings,
  type ParsedChangeRequestUrl,
  type ReferenceAutolink,
  type SourceControlDefinition,
  type SourceControlHostCredentials,
} from "@supaterm/source-control-core/shared/definition";
export type { SourceControlAppSignIn } from "@supaterm/contracts";

export const sourceControlClients = builtInSourceControlDefinitions;

export function readHostCredentialSettings(
  settings: Pick<ServerSettings, "sourceControlHosts">,
  kind: string,
): HostCredentialSettings {
  return readSourceControlHostSettings(HostCredentialSettings, settings.sourceControlHosts[kind]);
}

export function capitalizeTerm(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

export function appSignInTargetForRemote(
  remoteUrl: string,
  discovery: ReadonlyArray<
    Pick<SourceControlProviderDiscoveryItem, "kind" | "appSignInMetadata">
  > = [],
): {
  readonly definition: SourceControlDefinition;
  readonly appSignIn: SourceControlAppSignIn;
  readonly input: SourceControlAppAccessInput;
} | null {
  const parsed = parseGitRemoteRepository(remoteUrl);
  const provider = sourceControlClients.recognizeRemote(remoteUrl);
  const definition = provider ? sourceControlClients.find(provider.kind) : undefined;
  const appSignIn = discovery.find((item) => item.kind === definition?.kind)?.appSignInMetadata;
  if (parsed === null || definition === undefined || appSignIn === undefined) return null;
  if (!appSignIn.hosts.includes(parsed.host)) return null;

  const asWritten = remoteUrl
    .trim()
    .replace(/\.git\/?$/i, "")
    .split(/[/:]/)
    .slice(-2)
    .join("/");
  const repository = asWritten.toLowerCase() === parsed.path ? asWritten : parsed.path;
  return {
    definition,
    appSignIn,
    input: { provider: definition.kind, host: parsed.host, repository },
  };
}
