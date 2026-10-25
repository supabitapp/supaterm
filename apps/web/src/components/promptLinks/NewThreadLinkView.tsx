import { scopeProjectRef, scopeThreadRef } from "@supaterm/client-runtime/environment";
import { getCloneDestinationPath } from "@supaterm/client-runtime/operations/projects";
import {
  findPromptLinkProjects,
  findPromptLinkPullRequestThread,
  pickPromptLinkPullRequestThread,
  resolvePromptLinkModelSelection,
} from "@supaterm/client-runtime/prompt-links";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { EnvironmentId, ProjectId } from "@supaterm/contracts";
import {
  type NewThreadLink,
  type PromptLinkRepository,
  promptLinkPullRequestUrl,
} from "@supaterm/shared/promptLinks";
import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { isElectron } from "~/env";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useScratchProject } from "~/hooks/useScratchProject";
import { newProjectId } from "~/lib/utils";
import { useProjects, useThreadShells, waitForProject } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { environmentPresentations } from "~/state/presentation";
import { allReachableShellsLiveAtom, environmentShell } from "~/state/shell";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";

import { usePullRequestHandoffs } from "../pullRequest/usePullRequestActions";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { placeLinkedPrompt, warnAboutHiddenCharacters } from "./linkedPrompt";

type LinkState =
  | { readonly status: "opening" }
  | { readonly status: "opened" }
  | { readonly status: "failed"; readonly message: string; readonly title?: string }
  | { readonly status: "missing-repository"; readonly repository: PromptLinkRepository }
  | {
      readonly status: "pull-request-checkout";
      readonly project: EnvironmentProject;
    };

const openedLinkKeys = new Set<string>();

type PullRequestThreadLookup = {
  readonly targets: ReadonlyArray<readonly [environmentId: EnvironmentId, projectId: ProjectId]>;
  readonly repository: string;
  readonly number: number;
};

// A pull request's thread can be an older done thread no shell holds, so ask every
// environment with the repository.
const pullRequestThreadLookupAtom = Atom.family((key: string) => {
  const { targets, repository, number } = JSON.parse(key) as PullRequestThreadLookup;
  return Atom.make((get) =>
    pickPromptLinkPullRequestThread(
      targets
        // A shell that is not live cannot answer, and its lookup would wait forever.
        .filter(([environmentId]) => get(environmentShell.statusAtom(environmentId)) === "live")
        .map(([environmentId, projectId]) => ({
          environmentId,
          result: get(
            pullRequestEnvironment.linkedThreadsUncached({
              environmentId,
              input: { projectId, repository, number },
            }),
          ),
        })),
    ),
  ).pipe(Atom.withLabel(`web-prompt-link-pull-request-thread:${key}`));
});

const NO_PULL_REQUEST_THREAD_LOOKUP = Atom.make(null);

export function NewThreadLinkView({ link }: { readonly link: NewThreadLink }) {
  const locationKey = useLocation({ select: (location) => location.state.__TSR_key ?? "" });
  const navigate = useNavigate();
  const ready = useAtomValue(allReachableShellsLiveAtom);
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const handleNewThread = useNewThreadHandler();
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();
  const startProjectClone = useAtomCommand(sourceControlEnvironment.startProjectClone, {
    reportFailure: false,
  });
  const [state, setState] = useState<LinkState>(() =>
    openedLinkKeys.has(locationKey) ? { status: "opened" } : { status: "opening" },
  );
  const startedRef = useRef(false);

  const recentProjects = () =>
    sortScopedProjectsForSidebar(
      projects.filter((project) => project.isScratch !== true),
      threads,
      "updated_at",
    );

  const lastActiveEnvironmentId = () => {
    let latest: (typeof threads)[number] | undefined;
    for (const thread of threads) {
      if (latest === undefined || thread.updatedAt > latest.updatedAt) latest = thread;
    }
    return latest?.environmentId ?? primaryEnvironmentId;
  };

  const openDraft = async (project: EnvironmentProject, extraPrompt?: string) => {
    const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
      replace: true,
    }).catch(() => null);
    if (opened === null) {
      setState({ status: "failed", message: "Supaterm could not open a new thread." });
      return;
    }
    setState({ status: "opened" });
    const notes: Array<string> = [];
    if (link.kind === "new" && link.provider !== null) {
      const config = environments.find(
        (environment) => environment.environmentId === project.environmentId,
      )?.serverConfig;
      const providers =
        appAtomRegistry
          .get(environmentPresentations.providersByEnvironmentAtom)
          .get(project.environmentId) ?? [];
      const resolved = resolvePromptLinkModelSelection(
        providers,
        { provider: link.provider, model: link.model },
        config ? { settings: config.settings, projectId: project.id } : undefined,
      );
      if (resolved !== null) {
        useComposerDraftStore.getState().setModelSelection(opened.draftId, resolved.selection, {
          explicit: true,
          replaceOptions: true,
        });
      }
      if (resolved === null || !resolved.exact) {
        notes.push(
          resolved === null
            ? `The link asked for ${link.provider}, which is unavailable in this project, so your default model is used.`
            : `The link asked for ${link.model}, which ${link.provider} does not offer here, so its default model is used.`,
        );
      }
    }
    const text = [link.prompt?.text, extraPrompt].filter(Boolean).join("\n\n");
    if (text.length === 0) return;
    placeLinkedPrompt(
      opened.draftId,
      { text, hiddenCharacters: link.prompt?.hiddenCharacters ?? 0 },
      notes,
    );
  };

  const openWithoutProject = async () => {
    setState({ status: "opening" });
    const environmentId =
      scratchEnvironmentId(lastActiveEnvironmentId()) ?? scratchEnvironmentId(null);
    const project = environmentId === null ? null : await openScratchProject(environmentId);
    if (project === null) {
      setState({
        status: "failed",
        message: "None of your machines can start a thread without a project right now.",
      });
      return;
    }
    await openDraft(
      project,
      link.kind === "pull-request" ? promptLinkPullRequestUrl(link.pullRequest) : undefined,
    );
  };

  const cloneRepository = async (repository: PromptLinkRepository) => {
    const environmentId = lastActiveEnvironmentId();
    const environment = environments.find((entry) => entry.environmentId === environmentId);
    const newProjectsRoot = environment?.serverConfig?.newProjectsRoot ?? null;
    if (environmentId === null || newProjectsRoot === null || environment?.serverConfig == null) {
      setState({
        status: "failed",
        message:
          "This machine cannot clone from a link. Update Supaterm on it, or clone the repository from the command palette.",
      });
      return;
    }
    setState({ status: "opening" });
    const projectId = newProjectId();
    const result = await startProjectClone({
      environmentId,
      input: {
        projectId,
        title: repository.name,
        createdAt: new Date().toISOString(),
        remoteUrl: `https://github.com/${repository.owner}/${repository.name}.git`,
        destinationPath: getCloneDestinationPath(newProjectsRoot, repository.name),
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Clone failed",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      setState({ status: "missing-repository", repository });
      return;
    }
    const project = await waitForProject(scopeProjectRef(environmentId, projectId), 5_000).catch(
      () => null,
    );
    if (project === null) {
      setState({ status: "failed", message: "The clone started, but its project did not appear." });
      return;
    }
    if (link.kind === "pull-request") {
      setState({
        status: "failed",
        title: `Cloning ${repository.owner}/${repository.name}`,
        message: "Open this link again when the clone finishes.",
      });
      return;
    }
    await openDraft(project);
  };

  const localPullRequestThread =
    ready && link.kind === "pull-request"
      ? findPromptLinkPullRequestThread(threads, link.pullRequest)
      : undefined;
  // Mounted only while deciding, so "Open it again" asks the server again.
  const lookupProjects =
    ready &&
    state.status === "opening" &&
    link.kind === "pull-request" &&
    localPullRequestThread === undefined
      ? findPromptLinkProjects(recentProjects(), link.pullRequest)
      : [];
  const serverPullRequestThread = useAtomValue(
    link.kind === "pull-request" && lookupProjects.length > 0
      ? pullRequestThreadLookupAtom(
          JSON.stringify({
            targets: lookupProjects.map((project) => [project.environmentId, project.id]),
            repository: `${link.pullRequest.owner}/${link.pullRequest.name}`,
            number: link.pullRequest.number,
          } satisfies PullRequestThreadLookup),
        )
      : NO_PULL_REQUEST_THREAD_LOOKUP,
  );

  const start = useEffectEvent(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    openedLinkKeys.add(locationKey);
    if (link.kind === "pull-request") {
      const thread = localPullRequestThread ?? serverPullRequestThread ?? undefined;
      if (thread !== undefined) {
        setState({ status: "opened" });
        const threadRef = scopeThreadRef(thread.environmentId, thread.id);
        if (link.prompt !== null) placeLinkedPrompt(threadRef, link.prompt);
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: thread.environmentId, threadId: thread.id },
          replace: true,
        });
        return;
      }
    }
    const repository = link.kind === "new" ? link.repository : link.pullRequest;
    if (repository === null) {
      void openWithoutProject();
      return;
    }
    const project = findPromptLinkProjects(recentProjects(), repository)[0];
    if (project === undefined) {
      setState({ status: "missing-repository", repository });
      return;
    }
    if (link.kind === "pull-request") {
      setState({ status: "pull-request-checkout", project });
      return;
    }
    void openDraft(project);
  });

  const decided = serverPullRequestThread !== undefined;
  useEffect(() => {
    if (ready && decided && state.status === "opening") {
      let active = true;
      queueMicrotask(() => {
        if (active) start();
      });
      return () => {
        active = false;
      };
    }
  }, [ready, decided, state.status]);

  switch (state.status) {
    case "opening":
      return <LinkPage title="Opening the link..." />;
    case "opened":
      return (
        <LinkPage title="This link is open">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              openedLinkKeys.delete(locationKey);
              startedRef.current = false;
              setState({ status: "opening" });
            }}
          >
            Open it again
          </Button>
        </LinkPage>
      );
    case "failed":
      return (
        <LinkPage title={state.title ?? "Could not open the link"} description={state.message} />
      );
    case "missing-repository": {
      const name = `${state.repository.owner}/${state.repository.name}`;
      return (
        <LinkPage
          title={`You don't have ${name}`}
          description="Clone it to work on it here, or start without a project."
        >
          <Button size="sm" onClick={() => void cloneRepository(state.repository)}>
            Clone {name}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void openWithoutProject()}>
            Use without project
          </Button>
        </LinkPage>
      );
    }
    case "pull-request-checkout":
      return link.kind === "pull-request" ? (
        <PullRequestLinkCheckout link={link} project={state.project} />
      ) : null;
  }
}

/**
 * The checkout runs the project's setup script on code from the pull request, so a link alone
 * never starts it.
 */
function PullRequestLinkCheckout({
  link,
  project,
}: {
  readonly link: Extract<NewThreadLink, { kind: "pull-request" }>;
  readonly project: EnvironmentProject;
}) {
  const { handoff, startHandoff } = usePullRequestHandoffs({
    environmentId: project.environmentId,
    detail: {
      projectId: project.id,
      workspaceRoot: project.workspaceRoot,
      url: promptLinkPullRequestUrl(link.pullRequest),
    },
  });
  const warnedRef = useRef(false);
  useEffect(() => {
    if (warnedRef.current || link.prompt === null) return;
    warnedRef.current = true;
    warnAboutHiddenCharacters(link.prompt);
  }, [link.prompt]);
  const { owner, name, number } = link.pullRequest;
  return (
    <LinkPage
      title={`Check out ${owner}/${name}#${number}?`}
      description="This puts the pull request's code in a new worktree and runs your project's setup script on it."
    >
      <Button
        size="sm"
        disabled={handoff !== null}
        onClick={() =>
          void startHandoff(
            "prompt-link",
            link.prompt === null ? null : { prompt: link.prompt.text },
          )
        }
      >
        {handoff !== null ? "Checking out..." : "Check out"}
      </Button>
    </LinkPage>
  );
}

function LinkPage({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>{title}</EmptyTitle>
          {description ? <EmptyDescription>{description}</EmptyDescription> : null}
          {children ? <div className="mt-5 flex justify-center gap-2">{children}</div> : null}
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}
