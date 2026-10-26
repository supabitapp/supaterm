import { SourceControlProviderKind } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@supaterm/contracts";

import {
  availableScratchWorkspaceRoot,
  findExistingAddProject,
  getCloneDirectoryName,
  getDefaultCloneUrl,
  normalizePastedCloneUrl,
} from "./projects.ts";
import type { EnvironmentProject } from "../state/models.ts";
import { v2Project } from "../state/orchestrationV2TestFixtures.ts";

describe("scratch project availability", () => {
  const environmentId = EnvironmentId.make("local");
  const project = { ...v2Project, environmentId, workspaceRoot: "/scratch" };
  const input = {
    environmentId,
    serverConfig: { scratchWorkspaceRoot: "/scratch/" },
    projects: [project],
  };

  it.each(["connected", "available", "offline", "connecting", "reconnecting", "error"] as const)(
    "keeps an existing scratch project selectable while %s",
    (connectionPhase) => {
      expect(availableScratchWorkspaceRoot({ ...input, connectionPhase })).toBe("/scratch/");
    },
  );

  it("requires a connection to create the scratch project for the first time", () => {
    expect(
      availableScratchWorkspaceRoot({ ...input, projects: [], connectionPhase: "offline" }),
    ).toBeNull();
    expect(
      availableScratchWorkspaceRoot({ ...input, projects: [], connectionPhase: "connected" }),
    ).toBe("/scratch/");
  });

  it("does not use another environment's scratch project", () => {
    expect(
      availableScratchWorkspaceRoot({
        ...input,
        environmentId: EnvironmentId.make("other"),
        connectionPhase: "offline",
      }),
    ).toBeNull();
  });

  it("requires the configured scratch root rather than a matching project title", () => {
    expect(
      availableScratchWorkspaceRoot({
        ...input,
        projects: [{ ...project, title: "No project", workspaceRoot: "/other" }],
        connectionPhase: "offline",
      }),
    ).toBeNull();
    expect(
      availableScratchWorkspaceRoot({ ...input, serverConfig: null, connectionPhase: "offline" }),
    ).toBeNull();
  });
});

describe("add project shared logic", () => {
  it("routes owner/repository shorthand to GitHub over HTTPS", () => {
    expect(normalizePastedCloneUrl("imputnet/helium")).toBe(
      "https://github.com/imputnet/helium.git",
    );
    expect(normalizePastedCloneUrl("  supabitapp/supacode-next  ")).toBe(
      "https://github.com/supabitapp/supacode-next.git",
    );
  });

  it("keeps explicit clone URLs and local paths unchanged", () => {
    expect(normalizePastedCloneUrl("https://gitlab.com/group/project.git")).toBe(
      "https://gitlab.com/group/project.git",
    );
    expect(normalizePastedCloneUrl("git@github.com:owner/repo.git")).toBe(
      "git@github.com:owner/repo.git",
    );
    expect(normalizePastedCloneUrl("group/subgroup/project")).toBe("group/subgroup/project");
    expect(normalizePastedCloneUrl("/srv/git/repo.git")).toBe("/srv/git/repo.git");
  });

  it("uses HTTPS for repositories selected through a provider", () => {
    expect(
      getDefaultCloneUrl({
        provider: SourceControlProviderKind.make("github"),
        url: "https://github.com/imputnet/helium",
        sshUrl: "git@github.com:imputnet/helium.git",
      }),
    ).toBe("https://github.com/imputnet/helium");
    expect(
      getDefaultCloneUrl({
        provider: SourceControlProviderKind.make("forgejo"),
        url: "https://forgejo.example.test:8443/owner/repo.git",
        sshUrl: "ssh://git@forgejo.example.test:2222/owner/repo.git",
      }),
    ).toBe("https://forgejo.example.test:8443/owner/repo.git");
  });

  it("derives the clone folder name from any pasted clone URL", () => {
    expect(getCloneDirectoryName("https://github.com/owner/repo.git")).toBe("repo");
    expect(getCloneDirectoryName("https://github.com/owner/repo")).toBe("repo");
    expect(getCloneDirectoryName("https://github.com/owner/repo/")).toBe("repo");
    expect(getCloneDirectoryName("git@github.com:owner/repo.git")).toBe("repo");
    expect(getCloneDirectoryName("ssh://git@github.com:22/owner/repo.git")).toBe("repo");
    expect(getCloneDirectoryName("https://user@bitbucket.org/owner/repo.git")).toBe("repo");
    expect(getCloneDirectoryName("https://dev.azure.com/org/project/_git/repo")).toBe("repo");
    expect(getCloneDirectoryName("https://github.com/owner/repo.git?ref=main#readme")).toBe("repo");
    expect(getCloneDirectoryName("/srv/git/repo.git")).toBe("repo");
    expect(getCloneDirectoryName("C:\\src\\repo.git")).toBe("repo");
    expect(getCloneDirectoryName("git@github.com:repo.git")).toBe("repo");
    expect(getCloneDirectoryName("  https://github.com/owner/repo.git  ")).toBe("repo");
  });

  it("keeps a numeric repository name that sits on a path", () => {
    expect(getCloneDirectoryName("https://github.com/acme/123.git")).toBe("123");
    expect(getCloneDirectoryName("https://github.com/acme/123")).toBe("123");
    expect(getCloneDirectoryName("git@github.com:acme/123.git")).toBe("123");
  });

  it("finds existing projects by normalized path in the target environment", () => {
    const env = EnvironmentId.make("env");
    const other = EnvironmentId.make("other");
    const projects: EnvironmentProject[] = [
      {
        environmentId: other,
        id: ProjectId.make("same-path-other-env"),
        title: "Other",
        workspaceRoot: "/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
      },
      {
        environmentId: env,
        id: ProjectId.make("project"),
        title: "Repo",
        workspaceRoot: "/repo/",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
      },
    ];

    expect(findExistingAddProject({ projects, environmentId: env, path: "/repo" })?.id).toBe(
      "project",
    );
  });
});
