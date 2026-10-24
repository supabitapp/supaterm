import { ProjectId, SourceControlProviderKind } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { sourceControlClients } from "./sourceControlClients.ts";
import { normalizeThreadPullRequestKey } from "./threadPullRequests.ts";

const parse = (url: string) => {
  const parsed = sourceControlClients.parseChangeRequestUrl(url);
  if (parsed === null) return null;
  const { repositoryUrl: _repositoryUrl, ...link } = parsed.link;
  return link;
};
const kindOf = (url: string) => sourceControlClients.parseChangeRequestUrl(url)?.definition.kind;

describe("sourceControlClients.parseChangeRequestUrl", () => {
  it("reads a GitHub pull request, lower-casing the repository", () => {
    expect(parse("https://github.com/SupabitApp/Supaterm/pull/123")).toEqual({
      host: "github.com",
      repository: "supabitapp/supaterm",
      number: 123,
    });
  });

  it("reads a GitCafe pull request at its canonical /pull/ path and the older /pulls/ path", () => {
    for (const path of ["pull", "pulls"]) {
      const url = `https://git.cafe/SupabitApp/Supaterm/${path}/23897`;
      expect(parse(url), path).toEqual({
        host: "git.cafe",
        repository: "supabitapp/supaterm",
        number: 23897,
      });
      expect(kindOf(url), path).toBe("gitcafe");
    }
    expect(parse("https://staging.git.cafe/team/repo/pull/7/files")).toEqual({
      host: "staging.git.cafe",
      repository: "team/repo",
      number: 7,
    });
  });

  it("reads Forgejo URLs even when the hostname contains github", () => {
    expect(parse("https://github.internal/team/repo/pulls/7")).toEqual({
      host: "github.internal",
      authority: "github.internal",
      repository: "team/repo",
      number: 7,
    });
  });

  it("reads a GitHub pull request on any host, so GitHub Enterprise works on its own name", () => {
    expect(parse("https://code.github.example.com/acme/web/pull/42")).toEqual({
      host: "code.github.example.com",
      repository: "acme/web",
      number: 42,
    });
    expect(kindOf("https://scm.example.test/acme/web/pull/42")).toBe("github");
    expect(
      sourceControlClients.changeRequestUrlFromReferenceAutolink(
        "https://code.github.example.com/acme/web/issues/42",
      ),
    ).toBe("https://code.github.example.com/acme/web/pull/42");
  });

  it("reads a GitLab merge request on any host, nested groups and all", () => {
    expect(parse("https://gitlab.com/supabitapp/platform/supaterm/-/merge_requests/42")).toEqual({
      host: "gitlab.com",
      repository: "supabitapp/platform/supaterm",
      number: 42,
    });
    expect(parse("https://code.acme.test/team/project/-/merge_requests/9")).toEqual({
      host: "code.acme.test",
      repository: "team/project",
      number: 9,
    });
  });

  it("reads Bitbucket and both Azure DevOps URL forms", () => {
    expect(parse("https://bitbucket.org/workspace/repo/pull-requests/5")).toEqual({
      host: "bitbucket.org",
      repository: "workspace/repo",
      number: 5,
    });
    expect(parse("https://dev.azure.com/acme/platform/_git/supaterm/pullrequest/17")).toEqual({
      host: "dev.azure.com",
      repository: "acme/platform/_git/supaterm",
      number: 17,
    });
    expect(parse("https://acme.visualstudio.com/platform/_git/supaterm/pullrequest/17")).toEqual({
      host: "acme.visualstudio.com",
      repository: "platform/_git/supaterm",
      number: 17,
    });
  });

  it("reads Azure DevOps Server links and keeps servers on different ports distinct", () => {
    for (const host of ["scm.example.test", "git.cafe", "code.bitbucket.example.test"]) {
      const repository = "tfs/collection/project/_git/repo";
      const linked = {
        projectId: ProjectId.make("project-1"),
        host,
        repository,
        number: 123,
        url: `https://${host.toUpperCase()}:8443/tfs/Collection/Project/_git/Repo/pullrequest/123`,
      };
      const other = { ...linked, url: linked.url.replace(":8443/", ":9443/") };
      expect.soft(parse(linked.url), host).toEqual({
        host,
        authority: `${host}:8443`,
        repository,
        number: 123,
      });
      expect
        .soft(
          sourceControlClients.isSameChangeRequest(linked.url, `${linked.url}?view=files`),
          host,
        )
        .toBe(true);
      expect
        .soft(sourceControlClients.isSameChangeRequest(linked.url, other.url), host)
        .toBe(false);
      expect.soft([linked, other].map(normalizeThreadPullRequestKey), host).toEqual([
        { host: `${host}:8443`, repository, number: 123 },
        { host: `${host}:9443`, repository, number: 123 },
      ]);
    }
  });

  it("survives trailing segments, a trailing slash and a query string", () => {
    expect(parse("https://github.com/supabitapp/supaterm/pull/123/files?w=1")).toEqual({
      host: "github.com",
      repository: "supabitapp/supaterm",
      number: 123,
    });
    expect(parse("https://github.com/supabitapp/supaterm/pull/123/")).toEqual({
      host: "github.com",
      repository: "supabitapp/supaterm",
      number: 123,
    });
  });

  it("claims nothing it cannot be sure of", () => {
    for (const link of [
      "https://github.com/supabitapp/supaterm/issues/123",
      "https://git.cafe/supabitapp/supaterm/issues/23897",
      "https://git.cafe/supabitapp/supaterm/pull/abc",
      "https://git.cafe/supabitapp/supaterm",
      "https://github.com/supabitapp/supaterm/commit/0a1b2c3",
      "https://github.com/supabitapp/supaterm",
      "https://github.com/supabitapp/supaterm/pull/abc",
      "https://gitlab.com/supabitapp/supaterm/-/issues/12",
      "https://blog.example.test/2026/updates/archive/pull/3",
      "https://scm.example.test/tfs/Collection/Project/_git/Repo",
      "https://scm.example.test/tfs/Collection/Project/pullrequest/123",
      "https://scm.example.test/tfs/Collection/Project/_git/Repo/pullrequest/abc",
      "https://scm.example.test/tfs/Collection/Project/_git/Repo/pullrequest/0",
      "https://scm.example.test/tfs/Collection/Project/_git/Repo/pullrequest/9007199254740992",
      "ftp://scm.example.test/tfs/Collection/Project/_git/Repo/pullrequest/123",
      "javascript:alert(1)//github.com/supabitapp/supaterm/pull/1",
      "not a url",
    ]) {
      expect(parse(link), link).toBeNull();
    }
  });
});

describe("sourceControlClients.isSameChangeRequest", () => {
  const linked = "https://github.com/supabitapp/supaterm/pull/42";

  it("matches the same pull request whatever its case or trailing path", () => {
    expect(
      sourceControlClients.isSameChangeRequest(
        linked,
        "https://github.com/SupabitApp/Supaterm/pull/42/files",
      ),
    ).toBe(true);
  });

  it.each([
    ["http://forge.example:3000/git/team/repo/pulls/42/files", true],
    ["http://forge.example:4000/git/team/repo/pulls/42", false],
    ["http://forge.example/git/team/repo/pulls/42", false],
  ])("matches Forgejo links by web authority: %s", (url, expected) => {
    expect(
      sourceControlClients.isSameChangeRequest(
        "http://forge.example:3000/git/team/repo/pulls/42",
        url,
      ),
    ).toBe(expected);
  });

  it("keeps Forgejo and GitHub path shapes distinct on a GitHub-named host", () => {
    expect(
      sourceControlClients.isSameChangeRequest(
        "https://github.internal/team/repo/pulls/42",
        "https://github.internal/team/repo/pull/42",
      ),
    ).toBe(false);
  });
});

describe("change request URLs built from a parsed link", () => {
  const sibling = (url: string, number: number) => {
    const parsed = sourceControlClients.parseChangeRequestUrl(url)!;
    return parsed.definition.changeRequestUrl({
      host: parsed.link.host,
      repository: parsed.link.repository,
      number,
      webUrl: parsed.link.repositoryUrl,
    });
  };

  it.each([
    [
      "http://git.example.test:3000/team/repo/pulls/42/files",
      "http://git.example.test:3000/team/repo/pulls/43",
    ],
    ["https://github.com/pull/1/pull/42/files", "https://github.com/pull/1/pull/43"],
    [
      "https://dev.azure.com/acme/project/_git/web/pullrequest/42?view=files",
      "https://dev.azure.com/acme/project/_git/web/pullrequest/43",
    ],
  ])("builds a canonical sibling of %s", (url, expected) => {
    expect(sibling(url, 43)).toBe(expected);
  });

  it.each([
    ["ssh.dev.azure.com", "v3/org/project/web"],
    ["org.visualstudio.com", "defaultcollection/project/_git/web"],
    ["dev.azure.com", "org/project/_git/web"],
  ])("reads back the Azure browser URL built from the remote %s/%s", (host, repository) => {
    const url = sourceControlClients
      .get("azure-devops")
      .changeRequestUrl({ host, repository, number: 42 });
    expect(parse(url!)).toEqual({
      host: "dev.azure.com",
      repository: "org/project/_git/web",
      number: 42,
    });
  });
});

describe("sourceControlClients.recognizeRemote", () => {
  const kindOfRemote = (url: string) => sourceControlClients.recognizeRemote(url)?.kind ?? null;

  it("asks hosts in a fixed order when one hostname carries several hosts' labels", () => {
    expect(kindOfRemote("https://gitea.github.example/o/r")).toBe("forgejo");
    expect(kindOfRemote("https://forgejo.gitlab.example/o/r")).toBe("forgejo");
    expect(kindOfRemote("https://gitlab.github.example/o/r")).toBe("github");
    expect(kindOfRemote("https://bitbucket.gitlab.example/o/r")).toBe("gitlab");
    expect(kindOfRemote("https://bitbucket.visualstudio.com/p/_git/r")).toBe("azure-devops");
    expect(kindOfRemote("git@git.cafe:supabitapp/supaterm.git")).toBe("gitcafe");
  });

  it("reads a remote no host claims as an unknown host, and a local path as no host", () => {
    expect(
      sourceControlClients.recognizeRemote("https://self-hosted.example.test:8443/group/repo.git"),
    ).toEqual({
      kind: "unknown",
      name: "self-hosted.example.test:8443",
      baseUrl: "https://self-hosted.example.test:8443",
    });
    expect(sourceControlClients.recognizeRemote("git@github-work:owner/repo.git")).toEqual({
      kind: "unknown",
      name: "github-work",
      baseUrl: "https://github-work",
    });
    for (const local of ["/srv/git/repo.git", "C:/repos/project", "file:///srv/git/repo.git", ""]) {
      expect(sourceControlClients.recognizeRemote(local), local).toBeNull();
    }
  });
});

describe("sourceControlClients repository keys", () => {
  // Persisted as `repositoryIdentity.canonicalKey` and in thread pull request keys.
  it.each([
    ["git@github.com:SupabitApp/Supaterm.git", "github.com/supabitapp/supaterm"],
    ["ssh://git@gitlab.company.com:2222/team/project.git", "gitlab.company.com/team/project"],
    [
      "git@ssh.dev.azure.com:v3/SupabitApp/Platform/Supaterm",
      "dev.azure.com/supabitapp/platform/_git/supaterm",
    ],
    [
      "SupabitApp@vs-ssh.visualstudio.com:v3/SupabitApp/Platform/Supaterm",
      "supabitapp.visualstudio.com/platform/_git/supaterm",
    ],
    [
      "https://SupabitApp.visualstudio.com/DefaultCollection/Platform/_git/Supaterm",
      "supabitapp.visualstudio.com/defaultcollection/platform/_git/supaterm",
    ],
    ["git@ssh.dev.azure.com:v3/o/p", "ssh.dev.azure.com/v3/o/p"],
    ["ssh.dev.azure.com/v3/o/p/r", "ssh.dev.azure.com/v3/o/p/r"],
    ["C:/repos/project", "c:/repos/project"],
  ])("keys %s as %s", (remote, key) => {
    expect(sourceControlClients.repositoryKeyFromRemote(remote)).toBe(key);
  });

  it("compares Azure DevOps spellings on dev.azure.com and leaves other keys alone", () => {
    expect(
      sourceControlClients.canonicalRepositoryKey(
        "org.visualstudio.com/defaultcollection/project/_git/repo",
      ),
    ).toBe("dev.azure.com/org/project/_git/repo");
    expect(sourceControlClients.findByRepositoryKey("dev.azure.com/o/r")?.kind).toBe(
      "azure-devops",
    );
    expect(sourceControlClients.canonicalRepositoryKey("tfs.corp.example/c/p/_git/r")).toBe(
      "tfs.corp.example/c/p/_git/r",
    );
    expect(sourceControlClients.findByRepositoryKey("github.com/o/r")).toBeUndefined();
  });
});

describe("sourceControlClients project hosts", () => {
  const identity = {
    canonicalKey: "forge.example/team/repo",
    locator: { remoteUrl: "http://forge.example:3000/team/repo.git" },
  };

  it("keeps an HTTP remote's port for Forgejo only, and falls back to the kind without a key", () => {
    expect(sourceControlClients.changeRequestHost(identity, "forgejo")).toBe("forge.example:3000");
    expect(sourceControlClients.changeRequestHost(identity, "gitlab")).toBe("forge.example");
    expect(sourceControlClients.changeRequestHost(identity, undefined)).toBe("forge.example");
    expect(
      sourceControlClients.changeRequestHost(
        { locator: { remoteUrl: "https://x.example/a/b" } },
        "github",
      ),
    ).toBe("github");
  });

  it("selects a repository by its path except where the host's tools take a name", () => {
    const repository = {
      displayName: "group/subgroup/service",
      owner: "group",
      name: "service",
    };
    expect(sourceControlClients.repositorySelector(repository)).toBe("group/subgroup/service");
    expect(
      sourceControlClients.repositorySelector({
        ...repository,
        provider: SourceControlProviderKind.make("gitlab"),
      }),
    ).toBe("group/subgroup/service");
    expect(
      sourceControlClients.repositorySelector({
        ...repository,
        provider: SourceControlProviderKind.make("azure-devops"),
      }),
    ).toBe("service");
    expect(sourceControlClients.repositorySelector({ owner: "o", name: "r" })).toBe("o/r");
  });
});

describe("sourceControlClients.findByPublicDomain", () => {
  it("names the host a link is on, subdomains included", () => {
    const kindOf = (hostname: string) => sourceControlClients.findByPublicDomain(hostname)?.kind;
    expect(kindOf("gist.github.com")).toBe("github");
    expect(kindOf("GitLab.com")).toBe("gitlab");
    expect(kindOf("codeberg.org")).toBe("forgejo");
    expect(kindOf("notgithub.com")).toBeUndefined();
    expect(kindOf("github.com.example")).toBeUndefined();
  });

  it("leaves findByPublicHost to the public host alone", () => {
    expect(sourceControlClients.findByPublicHost("gist.github.com")).toBeUndefined();
  });
});
