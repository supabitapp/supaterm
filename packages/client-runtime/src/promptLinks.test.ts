import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  DEFAULT_SERVER_SETTINGS,
  ThreadId,
  type PullRequestLinkedThreadsResult,
  type RepositoryIdentity,
} from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  findPromptLinkProjects,
  pickPromptLinkPullRequestThread,
  resolvePromptLinkModelSelection,
} from "./promptLinks.ts";

const identity = (canonicalKey: string, origin?: string): RepositoryIdentity => ({
  canonicalKey,
  locator: { source: "git-remote", remoteName: "origin", remoteUrl: `https://${canonicalKey}` },
  ...(origin ? { origin: { canonicalKey: origin } } : {}),
});

describe("findPromptLinkProjects", () => {
  it("keeps exact matches in order and never a fork of the repository", () => {
    const projects = [
      {
        id: "fork",
        repositoryIdentity: identity(
          "github.com/supabitapp/supacode-next",
          "github.com/me/supacode-next",
        ),
      },
      { id: "none", repositoryIdentity: null },
      { id: "recent", repositoryIdentity: identity("github.com/SupabitApp/Supacode-Next") },
      { id: "older", repositoryIdentity: identity("github.com/supabitapp/supacode-next") },
    ];
    const ids = (owner: string, name: string) =>
      findPromptLinkProjects(projects, { owner, name }).map((project) => project.id);
    expect(ids("supabitapp", "supacode-next")).toEqual(["recent", "older"]);
    expect(ids("me", "supacode-next")).toEqual(["fork"]);
    expect(ids("gitlab", "x")).toEqual([]);
  });
});

describe("pickPromptLinkPullRequestThread", () => {
  it("takes the first open thread in order once every earlier lookup has answered", () => {
    const laptop = EnvironmentId.make("laptop");
    const server = EnvironmentId.make("server");
    const linked = (
      id: string,
      archivedAt: string | null = null,
    ): PullRequestLinkedThreadsResult => ({
      threads: [{ id: ThreadId.make(id), projectId: ProjectId.make("p"), title: id, archivedAt }],
    });
    const none: PullRequestLinkedThreadsResult = { threads: [] };
    const pick = (
      ...results: ReadonlyArray<AsyncResult.AsyncResult<PullRequestLinkedThreadsResult, unknown>>
    ) =>
      pickPromptLinkPullRequestThread(
        results.map((result, index) => ({ environmentId: index === 0 ? laptop : server, result })),
      );
    // A value shown while it refetches is not an answer yet.
    expect(pick(AsyncResult.success(none, { waiting: true }))).toBeUndefined();
    expect(pick(AsyncResult.success(none), AsyncResult.initial(true))).toBeUndefined();
    expect(pick(AsyncResult.initial(true), AsyncResult.success(linked("b")))).toBeUndefined();
    const laptopThread = { environmentId: laptop, id: ThreadId.make("a") };
    expect(pick(AsyncResult.success(linked("a")), AsyncResult.initial(true))).toEqual(laptopThread);
    expect(pick(AsyncResult.success(linked("a")), AsyncResult.success(linked("b")))).toEqual(
      laptopThread,
    );
    expect(pick(AsyncResult.success(none), AsyncResult.success(linked("old")))).toEqual({
      environmentId: server,
      id: ThreadId.make("old"),
    });
    expect(
      pick(
        AsyncResult.success(linked("archived", "2026-01-01T00:00:00.000Z")),
        AsyncResult.fail(1),
      ),
    ).toBeNull();
  });
});

describe("resolvePromptLinkModelSelection", () => {
  const provider = (
    instanceId: string,
    driver: string,
    status: "ready" | "warning" | "error" | "disabled" = "ready",
  ) => ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    status,
    models: [
      { slug: "small", name: "Small" },
      { slug: "big", name: "Big", aliases: ["opus"], isDefault: true },
    ],
  });

  it("maps the requested provider and model onto a usable instance", () => {
    const providers = [provider("broken", "claudeAgent", "error"), provider("work", "claudeAgent")];
    expect(
      resolvePromptLinkModelSelection(providers, { provider: "claude", model: "small" }),
    ).toEqual({
      selection: { instanceId: "work", model: "small" },
      exact: true,
    });
    expect(
      resolvePromptLinkModelSelection(providers, { provider: "claudeagent", model: "opus" }),
    ).toEqual({
      selection: { instanceId: "work", model: "big" },
      exact: true,
    });
  });

  it("uses the instance default for an unknown model, and nothing for a missing provider", () => {
    const providers = [provider("codex", "codex")];
    expect(
      resolvePromptLinkModelSelection(providers, { provider: "codex", model: "nope" }),
    ).toEqual({
      selection: { instanceId: "codex", model: "big" },
      exact: false,
    });
    expect(
      resolvePromptLinkModelSelection(providers, { provider: "cursor", model: null }),
    ).toBeNull();
  });

  it("respects the destination project's enablement rather than machine enablement", () => {
    const projectId = ProjectId.make("project-a");
    const instanceId = ProviderInstanceId.make("codex");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), config: {}, enabled: true },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: false } } },
      },
    };
    const providers = [provider("codex", "codex")];
    const request = { provider: "codex", model: "small" };
    expect(resolvePromptLinkModelSelection(providers, request, { settings, projectId })).toBeNull();
    expect(
      resolvePromptLinkModelSelection(providers, request, { settings, projectId: null }),
    ).toMatchObject({
      selection: { instanceId, model: "small" },
      exact: true,
    });
    settings.projectSettingsOverrides[projectId]!.providerInstances[instanceId]!.enabled = true;
    expect(
      resolvePromptLinkModelSelection([{ ...providers[0]!, enabled: false }], request, {
        settings,
        projectId,
      }),
    ).toMatchObject({
      selection: { instanceId, model: "small" },
      exact: true,
    });
  });
});
