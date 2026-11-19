import { SourceControlProviderKind } from "@supaterm/contracts";
import { canonicalRepositoryPath } from "@supaterm/shared/git";
import {
  buildCommitUrl,
  changeRequestUrlBelow,
  defineSourceControl,
  isChangeRequestAuthorityOfProject,
  parseChangeRequestPath,
  parseCommitPath,
  remoteWebOrigin,
} from "@supaterm/source-control-core/shared/definition";
import { icon } from "./icon.ts";

const CHANGE_REQUEST_PATH = /^\/((?:[^/]+\/)*_git\/[^/]+)\/pullrequest\/(\d+)(?:\/|$)/u;
const COMMIT_PATH = /^\/((?:[^/]+\/)*_git\/[^/]+)\/commit\/([0-9a-f]+)\/?$/iu;
const CHECKOUT_COMMAND = /^az\s+repos\s+pr\s+checkout\s+(.+)$/i;
const CHANGE_REQUEST_REFERENCE =
  /^https:\/\/(?:dev\.azure\.com\/[^/\s]+\/[^/\s]+|[^/\s]+\.visualstudio\.com\/(?:DefaultCollection\/)?[^/\s]+)\/_git\/[^/\s]+\/pullrequest\/(\d+)(?:[/?#].*)?$/i;

function isAzureHostname(hostname: string): boolean {
  return (
    hostname === "dev.azure.com" ||
    hostname.endsWith(".dev.azure.com") ||
    hostname.endsWith(".visualstudio.com")
  );
}

function repositoryKeyFromRemote(key: string): string | null {
  const match =
    /^(ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com)\/v3\/([^/]+)\/([^/]+)\/([^/]+)$/u.exec(key);
  if (match === null) {
    return isAzureHostname(key.split("/", 1)[0]!) ? key : null;
  }
  const [, host, organization, project, repository] = match;
  return host === "ssh.dev.azure.com"
    ? `dev.azure.com/${organization}/${project}/_git/${repository}`
    : `${organization}.visualstudio.com/${project}/_git/${repository}`;
}

function canonicalRepositoryKey(key: string): string | null {
  const canonical = key
    .replace(
      /^(?:ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com)\/v3\/([^/]+)\/([^/]+)\/([^/]+)$/u,
      "dev.azure.com/$1/$2/_git/$3",
    )
    .replace(
      /^([^.]+)\.visualstudio\.com\/(?:defaultcollection\/)?([^/]+)\/_git\/([^/]+)$/u,
      "dev.azure.com/$1/$2/_git/$3",
    );
  return canonical.startsWith("dev.azure.com/") ? canonical : null;
}

function decodeUrlPathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function checkoutCommandId(args: string): string | null {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  for (const [index, part] of parts.entries()) {
    if (part === "--id" || part === "-i") return parts[index + 1] ?? null;
    if (part.startsWith("--id=")) return part.slice("--id=".length) || null;
  }
  return parts.find((part) => !part.startsWith("-")) ?? null;
}

const KIND = SourceControlProviderKind.make("azure-devops");

export const definition = defineSourceControl({
  kind: KIND,
  label: "Azure DevOps",
  pickerLabel: "Azure DevOps",
  icon,
  changeRequest: {
    shortLabel: "PR",
    shortLabelWithArticle: "a PR",
    singular: "pull request",
    plural: "pull requests",
  },
  repositoryPathHint: "project/repository",
  publicHost: null,
  publishDescription: "dev.azure.com",
  publishHost: () => "dev.azure.com",
  newRepositoryOwner: () => null,
  defaultCloneTransport: "ssh",
  changeRequestUrl: ({ host, repository, number, remoteUrl, webUrl }) => {
    if (webUrl) return changeRequestUrlBelow(webUrl, `pullrequest/${number}`);
    const key = `${host}/${repository}`.toLowerCase();
    const [canonicalHost = host, ...path] = (canonicalRepositoryKey(key) ?? key).split("/");
    return `${remoteWebOrigin(canonicalHost, remoteUrl)}/${path.join("/")}/pullrequest/${number}`;
  },
  commitUrl: (input) => {
    const key = `${input.host}/${input.repository}`.toLowerCase();
    const [host = input.host, ...path] = (canonicalRepositoryKey(key) ?? key).split("/");
    return buildCommitUrl({ ...input, host, repository: path.join("/") }, "commit");
  },
  parseCommitUrl: (url) => parseCommitPath(url, COMMIT_PATH),
  parseChangeRequestUrl: (url) => {
    const link = parseChangeRequestPath(url, CHANGE_REQUEST_PATH);
    return link === null || url.port === "" ? link : { ...link, authority: url.host.toLowerCase() };
  },
  changeRequestUrlFromReferenceAutolink: () => null,
  changeRequestActions: new Set([
    "merge",
    "ready",
    "draft",
    "close",
    "reopen",
    "enable-auto-merge",
    "disable-auto-merge",
  ] as const),
  checkoutCommand: ({ number }) => `az repos pr checkout --id ${number}`,
  changeRequestCloseCommand:
    /\baz\s+repos\s+pr\s+update\b[^;&|]*--status[\s=]+["']?(?:completed|abandoned)\b/u,
  authorProfileUrl: () => null,
  hardLineBreaks: true,
  reviewSummaryRequired: () => false,
  checkoutCommandArgument: (input) => {
    const args = CHECKOUT_COMMAND.exec(input)?.[1];
    return args ? checkoutCommandId(args) : null;
  },
  isChangeRequestReference: (url) => CHANGE_REQUEST_REFERENCE.test(url),
  checkoutChangeRequestHost: () => null,
  recognizeRemote: ({ host, hostname }) =>
    isAzureHostname(hostname)
      ? { kind: KIND, name: "Azure DevOps", baseUrl: `https://${host}` }
      : null,
  /**
   * `az repos pr list --repository` takes a name; organisation and project come from checkout.
   * Decode the remote URL's name segment: `az` treats escapes literally and returns 404.
   */
  repositorySelector: (identity) => {
    const segments = (identity.displayName ?? "").split("/").filter((part) => part !== "_git");
    const name = identity.name || segments.at(-1);
    return name ? decodeUrlPathSegment(name) : null;
  },
  repositoryKeyFromRemote,
  canonicalRepositoryKey,
  isChangeRequestInRepository: (identity, link) => {
    if (!isChangeRequestAuthorityOfProject(identity, link)) return false;
    const projectKey = canonicalRepositoryPath(identity.canonicalKey);
    const linkKey = canonicalRepositoryPath(`${link.host}/${link.repository}`);
    return (
      (canonicalRepositoryKey(projectKey) ?? projectKey) ===
      (canonicalRepositoryKey(linkKey) ?? linkKey)
    );
  },
  canReadChangeRequestOnHost: () => false,
});
