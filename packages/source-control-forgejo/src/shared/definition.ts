import { SourceControlProviderKind } from "@supaterm/contracts";
import { canonicalRepositoryPath } from "@supaterm/shared/git";
import {
  buildCommitUrl,
  changeRequestUrlBelow,
  type ChangeRequestHostIdentity,
  defineSourceControl,
  isChangeRequestAuthorityOfProject,
  isChangeRequestInProjectRepository,
  isChangeRequestOnProjectHost,
  parseChangeRequestPath,
  parseCommitPath,
  repositoryUrlFromPagePath,
  projectChangeRequestHost,
  remoteWebOrigin,
} from "@supaterm/source-control-core/shared/definition";
import { icon } from "./icon.ts";

const CHECKOUT_COMMAND = /^tea\s+(?:pr|pulls?)\s+(?:checkout|co)\s+(.+)$/i;
const CHANGE_REQUEST_REFERENCE =
  /^https?:\/\/[^/\s]+\/(?:[^/\s]+\/)+[^/\s]+\/pulls\/(\d+)(?:[/?#].*)?$/i;

const CHANGE_REQUEST_PATH = /^\/([^/]+(?:\/[^/]+)+)\/pulls\/(\d+)(?:\/|$)/u;
const COMMIT_PATH = /^\/([^/]+(?:\/[^/]+)+)\/commit\/([0-9a-f]+)\/?$/iu;
const REPOSITORY_PAGE_PATH = /^\/([^/]+(?:\/[^/]+)+?)\/src\/(?:branch|tag|commit)\/[^/]/u;

const KIND = SourceControlProviderKind.make("forgejo");

const changeRequestHeadRef = (number: number) => `refs/pull/${number}/head`;

function resolvedWebUrl(identity: ChangeRequestHostIdentity) {
  if (!identity?.webUrl) return null;
  try {
    const url = new URL(identity.webUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function changeRequestHost(identity: ChangeRequestHostIdentity) {
  const web = resolvedWebUrl(identity);
  if (web) return web.host.toLowerCase();
  try {
    const remote = new URL(identity?.locator?.remoteUrl ?? "");
    if (remote.protocol === "http:" || remote.protocol === "https:") {
      return remote.host.toLowerCase();
    }
  } catch {}
  return projectChangeRequestHost(identity, KIND);
}

export const definition = defineSourceControl({
  kind: KIND,
  label: "Forgejo",
  pickerLabel: "Forgejo / Gitea",
  icon,
  searchKeywords: ["gitea", "tea", "codeberg"],
  changeRequest: {
    shortLabel: "PR",
    shortLabelWithArticle: "a PR",
    singular: "pull request",
    plural: "pull requests",
  },
  repositoryPathHint: "owner/repo",
  publicHost: "codeberg.org",
  publishDescription: "Your signed-in server",
  publishHost: (signedInHost) => signedInHost ?? "your server",
  newRepositoryOwner: (account) => (account ? { owner: account } : null),
  defaultCloneTransport: "https",
  changeRequestUrl: ({ host, repository, number, remoteUrl, webUrl }) =>
    webUrl
      ? changeRequestUrlBelow(webUrl, `pulls/${number}`)
      : `${remoteWebOrigin(host, remoteUrl)}/${repository}/pulls/${number}`,
  parseChangeRequestUrl: (url) => {
    const link = parseChangeRequestPath(url, CHANGE_REQUEST_PATH);
    return link === null ? null : { ...link, authority: url.host.toLowerCase() };
  },
  changeRequestUrlFromReferenceAutolink: () => null,
  commitUrl: (input) => buildCommitUrl(input, "commit"),
  parseCommitUrl: (url) => parseCommitPath(url, COMMIT_PATH),
  repositoryUrlFromPage: (url, known) => {
    if (url.pathname.replace(/\/$/u, "").endsWith(".git")) return null;
    const repositoryUrl = repositoryUrlFromPagePath(url, REPOSITORY_PAGE_PATH);
    return repositoryUrl === null || known ? repositoryUrl : url.href;
  },
  changeRequestActions: new Set(["merge", "close", "reopen", "update-branch"] as const),
  checkoutCommand: ({ number, repositoryUrl }) =>
    repositoryUrl
      ? `git fetch '${repositoryUrl.replaceAll("'", "'\\''")}' ${changeRequestHeadRef(number)} && git checkout -B pulls/${number} FETCH_HEAD`
      : null,
  changeRequestCloseCommand: /\b(?:tea\s+(?:pr|pulls?)|fj\s+pr)\s+(?:merge|m|close)\b/u,
  authorProfileUrl: () => null,
  hardLineBreaks: true,
  reviewSummaryRequired: (verdict) => verdict === "request-changes",
  checkoutCommandArgument: (input) => CHECKOUT_COMMAND.exec(input)?.[1]?.trim() ?? null,
  isChangeRequestReference: (url) => CHANGE_REQUEST_REFERENCE.test(url),
  checkoutChangeRequestHost: () => null,
  changeRequestHeadRef,
  recognizeRemote: ({ remoteUrl, host, hostname }) =>
    hostname === "codeberg.org" ||
    hostname.split(".").includes("forgejo") ||
    hostname.split(".").includes("gitea")
      ? {
          kind: KIND,
          name: "Forgejo",
          baseUrl: /^https?:/iu.test(remoteUrl) ? new URL(remoteUrl).origin : `https://${host}`,
        }
      : null,
  changeRequestHost,
  isChangeRequestInRepository: (identity, link) => {
    if (!isChangeRequestAuthorityOfProject(identity, link)) return false;
    const web = resolvedWebUrl(identity);
    if (!web)
      return isChangeRequestInProjectRepository(changeRequestHost(identity), identity, link);
    return (
      web.host.toLowerCase() === (link.authority ?? link.host).toLowerCase() &&
      canonicalRepositoryPath(web.pathname.replace(/^\/+|\/+$/g, "")) ===
        canonicalRepositoryPath(link.repository)
    );
  },
  canReadChangeRequestOnHost: (identity, link) => {
    const web = resolvedWebUrl(identity);
    if (!web) return isChangeRequestOnProjectHost(changeRequestHost(identity), identity, link);
    const mount = web.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .slice(0, -2)
      .join("/");
    return (
      web.host.toLowerCase() === (link.authority ?? link.host).toLowerCase() &&
      (!mount || link.repository.toLowerCase().startsWith(`${mount.toLowerCase()}/`))
    );
  },
});
