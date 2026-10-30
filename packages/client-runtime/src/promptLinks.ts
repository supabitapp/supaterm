import {
  repositoryGroupingKeyOf,
  type ModelSelection,
  type ProjectId,
  type ServerSettings,
  resolveProjectProviderInstanceEnabled,
  type RepositoryIdentity,
  type ServerProvider,
  type ThreadLinkedPullRequest,
  type ThreadPullRequestLink,
} from "@supaterm/contracts";
import { resolveSelectableModel, type SelectableModelOption } from "@supaterm/shared/model";
import type { PromptLinkPullRequest, PromptLinkRepository } from "@supaterm/shared/promptLinks";
import {
  threadPullRequestKeyOf,
  threadPullRequestsOf,
  visibleThreadPullRequests,
} from "@supaterm/shared/threadPullRequests";

const repositoryKey = (repository: PromptLinkRepository) =>
  `github.com/${repository.owner}/${repository.name}`.toLowerCase();

/**
 * Callers pass projects most recently active first, so the user lands where they last worked.
 */
export function findPromptLinkProject<
  P extends { readonly repositoryIdentity?: RepositoryIdentity | null | undefined },
>(projects: ReadonlyArray<P>, repository: PromptLinkRepository): P | undefined {
  const key = repositoryKey(repository);
  return projects.find(
    (project) =>
      project.repositoryIdentity != null &&
      repositoryGroupingKeyOf(project.repositoryIdentity).toLowerCase() === key,
  );
}

export function findPromptLinkPullRequestThread<
  T extends {
    readonly updatedAt: string;
    readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink> | undefined;
    readonly linkedPullRequest?: ThreadLinkedPullRequest | null | undefined;
  },
>(threads: ReadonlyArray<T>, pullRequest: PromptLinkPullRequest): T | undefined {
  const key = threadPullRequestKeyOf({
    host: "github.com",
    repository: `${pullRequest.owner}/${pullRequest.name}`,
    number: pullRequest.number,
  });
  let latest: T | undefined;
  for (const thread of threads) {
    if (latest !== undefined && thread.updatedAt <= latest.updatedAt) continue;
    const linked = visibleThreadPullRequests(threadPullRequestsOf(thread)).some(
      (link) => threadPullRequestKeyOf(link) === key,
    );
    if (linked) latest = thread;
  }
  return latest;
}

const PROVIDER_ALIASES: Record<string, string> = { claude: "claudeagent" };

/**
 * `exact` is false when the instance exists but the model does not, so its default model
 * stands in. Null when no usable instance of that provider exists; the user's default
 * applies then.
 */
export function resolvePromptLinkModelSelection(
  providers: ReadonlyArray<
    Pick<ServerProvider, "instanceId" | "driver" | "enabled" | "availability" | "status"> & {
      readonly models: ReadonlyArray<
        SelectableModelOption & { readonly isDefault?: boolean | undefined }
      >;
    }
  >,
  request: { readonly provider: string; readonly model: string | null },
  context?: {
    readonly settings: Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">;
    readonly projectId: ProjectId | null;
  },
): { readonly selection: ModelSelection; readonly exact: boolean } | null {
  const driver = PROVIDER_ALIASES[request.provider] ?? request.provider;
  const usable = providers.filter(
    (provider) =>
      provider.driver.toLowerCase() === driver &&
      (context
        ? resolveProjectProviderInstanceEnabled(
            context.settings,
            context.projectId,
            provider.instanceId,
          )
        : provider.enabled) &&
      provider.availability !== "unavailable",
  );
  const instance =
    usable.find((provider) => provider.status === "ready") ??
    usable.find((provider) => provider.status === "warning");
  if (instance === undefined) return null;
  const requested =
    request.model === null
      ? null
      : resolveSelectableModel(instance.driver, request.model, instance.models);
  const model =
    requested ??
    (instance.models.find((candidate) => candidate.isDefault) ?? instance.models[0])?.slug;
  if (model === undefined) return null;
  return {
    selection: { instanceId: instance.instanceId, model },
    exact: request.model === null || requested !== null,
  };
}
