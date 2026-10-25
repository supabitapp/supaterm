import * as Dialog from "../../components/ui/Dialog";
import type {
  EnvironmentId,
  ProjectId,
  ServerProvider,
  ThreadId,
  ThreadPullRequestLink,
} from "@supaterm/contracts";
import { matchComposerThreadItems } from "@supaterm/client-runtime/composerThreadItems";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/models";

const EMPTY_THREAD_SHELLS: ReadonlyArray<EnvironmentThreadShell> = [];
import {
  COMPOSER_CONTEXT_MAX_RECORDS,
  PROVIDER_WORKSPACE_SNAPSHOT_TTL_MS,
} from "@supaterm/contracts";
import { formatComposerContextReference } from "@supaterm/shared/composerContextReferences";
import { pullRequestComposerContext, threadComposerContext } from "../../lib/composerContext";
import { uuidv4 } from "../../lib/uuid";
import {
  getComposerDraftSnapshot,
  readComposerDraftSelection,
  setComposerDraftContext,
} from "../../state/use-composer-drafts";
import { USAGE_LIMITS_COMMAND } from "@supaterm/shared/usageLimits";
import {
  detectComposerTrigger,
  replaceTextRange,
  serializeComposerFileLink,
  type ComposerTrigger,
} from "@supaterm/shared/composerTrigger";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@supaterm/shared/searchRanking";
import {
  dedupeProviderSkillsByName,
  getProviderSkillsForSlashMenu,
  getProviderSlashCommandsForSlashMenu,
  isProviderSkillUserInvocable,
  hasCompleteProviderWorkspaceSnapshot,
  hasCurrentProviderWorkspaceSnapshot,
  resolveProviderSkillsForCwd,
  resolveProviderSlashCommandsForCwd,
} from "@supaterm/client-runtime/providerSkills";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";

import type { ComposerEditorSelection } from "../../components/ComposerEditor";
import { showSkillsInSlashMenuAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  useComposerPathSearch,
  useComposerPullRequestSearch,
  useThreadSearch,
} from "../../state/queries";
import type { ComposerCommandItem } from "./ComposerCommandPopover";
import { matchesCommandMenuSkillQuery } from "./composerCommandMenuSkillSearch";

const WORKSPACE_SNAPSHOT_RETRY_COOLDOWN_MS = 10_000;

function composerSelectionAtEnd(draftMessage: string): ComposerEditorSelection {
  return { start: draftMessage.length, end: draftMessage.length };
}

export function buildComposerSlashCommandItems(input: {
  readonly query: string;
  readonly hasThread: boolean;
  readonly hasCompactableConversation?: boolean;
  readonly offersUsageLimits?: boolean;
  readonly selectedProviderStatus: Pick<ServerProvider, "driver" | "slashCommands"> | null;
}): ComposerCommandItem[] {
  const query = input.query.toLowerCase();
  const builtIn = [
    {
      id: "cmd:model",
      type: "slash-command",
      command: "model",
      label: "/model",
      description: "Switch model",
    },
  ] satisfies ComposerCommandItem[];
  const items: ComposerCommandItem[] = builtIn.filter((item) => item.command.includes(query));

  for (const command of input.selectedProviderStatus?.slashCommands ?? []) {
    if (!command.name.toLowerCase().includes(query)) continue;
    if (command.name === "compact" && !input.hasCompactableConversation) continue;
    if (command.name === USAGE_LIMITS_COMMAND.name && input.offersUsageLimits && !input.hasThread) {
      continue;
    }
    if (
      !input.hasThread &&
      input.selectedProviderStatus?.driver === "codex" &&
      command.name === "feedback"
    ) {
      continue;
    }
    items.push({
      id: `pcmd:${command.name}`,
      type: "provider-slash-command",
      command,
      label: `/${command.name}`,
      description: command.description ?? "",
    });
  }
  return items;
}

export function resolveComposerCommandSelection(input: {
  readonly draftMessage: string;
  readonly trigger: Pick<ComposerTrigger, "rangeStart" | "rangeEnd">;
  readonly item: ComposerCommandItem;
}): {
  readonly text: string;
  readonly cursor: number;
} {
  const { draftMessage, trigger, item } = input;

  let replacement = "";
  if (item.type === "path") {
    replacement = `${serializeComposerFileLink(item.path)} `;
  } else if (item.type === "skill") {
    replacement = `$${item.skill.name} `;
  } else if (item.type === "slash-command") {
    replacement = `/${item.command} `;
  } else if (item.type === "provider-slash-command") {
    replacement = `/${item.command.name} `;
  }
  return replaceTextRange(draftMessage, trigger.rangeStart, trigger.rangeEnd, replacement);
}

export function useComposerCommandMenu({
  draftMessage,
  ownerKey,
  environmentId,
  threadShells = EMPTY_THREAD_SHELLS,
  currentThreadId = null,
  projectCwd,
  pullRequestProjectId = null,
  pullRequestRepository = null,
  threadPullRequests,
  selectedProviderStatus,
  hasThread,
  hasCompactableConversation,
  offersUsageLimits = false,
  enabled = true,
  onChangeDraftMessage,
  onUsageLimits,
}: {
  readonly draftMessage: string;
  readonly ownerKey: string | null;
  readonly environmentId: EnvironmentId | null;
  readonly threadShells?: ReadonlyArray<EnvironmentThreadShell>;
  readonly currentThreadId?: ThreadId | null;
  readonly projectCwd: string | null;
  readonly pullRequestProjectId?: ProjectId | null;
  readonly pullRequestRepository?: string | null;
  readonly threadPullRequests?: ReadonlyArray<ThreadPullRequestLink>;
  readonly selectedProviderStatus: ServerProvider | null;
  readonly hasThread: boolean;
  readonly hasCompactableConversation: boolean;
  readonly offersUsageLimits?: boolean;
  readonly enabled?: boolean;
  readonly onChangeDraftMessage: (value: string) => void;
  readonly onUsageLimits?: () => void;
}) {
  const [selection, setSelection] = useState(
    () =>
      (ownerKey ? readComposerDraftSelection(ownerKey, draftMessage) : null) ??
      composerSelectionAtEnd(draftMessage),
  );
  const [selectionSource, setSelectionSource] = useState({ draftMessage, ownerKey });
  // Thread mentions rank by recency as of when the composer mounted.
  const [now] = useState(() => Date.now());
  const onSelectionChange = (nextSelection: ComposerEditorSelection) => {
    setSelection(nextSelection);
  };
  if (selectionSource.draftMessage !== draftMessage || selectionSource.ownerKey !== ownerKey) {
    setSelectionSource({ draftMessage, ownerKey });
    if (selectionSource.ownerKey !== ownerKey) {
      setSelection(composerSelectionAtEnd(draftMessage));
    } else {
      const inserted = ownerKey ? readComposerDraftSelection(ownerKey, draftMessage) : null;
      if (inserted) {
        setSelection((current) =>
          current.start === inserted.start && current.end === inserted.end ? current : inserted,
        );
      } else {
        const end = draftMessage.length;
        setSelection((current) => {
          const start = Math.min(current.start, end);
          const selectionEnd = Math.min(current.end, end);
          if (start === current.start && selectionEnd === current.end) {
            return current;
          }
          return { start, end: selectionEnd };
        });
      }
    }
  }

  const skills = selectedProviderStatus
    ? resolveProviderSkillsForCwd(selectedProviderStatus, projectCwd)
    : [];
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const selectedProviderInstanceId = selectedProviderStatus?.instanceId;
  const hasWorkspaceSnapshot = hasCompleteProviderWorkspaceSnapshot(
    selectedProviderStatus,
    projectCwd,
  );
  // Record client request time to enforce TTL even when the client clock runs ahead of the server.
  const workspaceRefreshKeyRef = useRef<{ key: string; requestedAt: number } | null>(null);
  const [workspaceRefreshRetry, setWorkspaceRefreshRetry] = useState<{
    key: string;
    notBefore: number;
  } | null>(null);
  const workspaceRefreshScopeKey =
    environmentId && projectCwd && selectedProviderInstanceId
      ? `${environmentId}:${selectedProviderInstanceId}:${projectCwd}`
      : null;
  const workspaceSlashCommandsPending =
    selectedProviderStatus?.workspaceSnapshots?.some(
      (snapshot) => snapshot.cwd === projectCwd && snapshot.slashCommandsPending === true,
    ) ?? false;
  useEffect(() => {
    if (
      !workspaceSlashCommandsPending ||
      !workspaceRefreshRetry ||
      workspaceRefreshRetry.key !== workspaceRefreshScopeKey
    )
      return;
    const timeout = setTimeout(
      () => {
        setWorkspaceRefreshRetry((current) => (current === workspaceRefreshRetry ? null : current));
      },
      Math.max(0, workspaceRefreshRetry.notBefore - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [workspaceRefreshRetry, workspaceRefreshScopeKey, workspaceSlashCommandsPending]);
  const hadWorkspaceSnapshotRef = useRef(false);
  useEffect(() => {
    if (hadWorkspaceSnapshotRef.current && !hasWorkspaceSnapshot) {
      workspaceRefreshKeyRef.current = null;
    }
    hadWorkspaceSnapshotRef.current = hasWorkspaceSnapshot;
  }, [hasWorkspaceSnapshot]);
  useEffect(() => {
    if (!environmentId || !projectCwd || !selectedProviderInstanceId) return;
    const key = `${environmentId}:${selectedProviderInstanceId}:${projectCwd}`;
    const now = Date.now();
    const lastRequest = workspaceRefreshKeyRef.current;
    if (
      lastRequest?.key === key &&
      now - lastRequest.requestedAt < PROVIDER_WORKSPACE_SNAPSHOT_TTL_MS
    )
      return;
    if (hasCurrentProviderWorkspaceSnapshot(selectedProviderStatus, projectCwd, now)) {
      return;
    }
    const retry = workspaceRefreshRetry;
    if (retry?.key === key && now < retry.notBefore) return;
    const request = { key, requestedAt: now };
    workspaceRefreshKeyRef.current = request;
    const retryLater = () => {
      if (workspaceRefreshKeyRef.current !== request) return;
      workspaceRefreshKeyRef.current = null;
      setWorkspaceRefreshRetry({
        key,
        notBefore: Date.now() + WORKSPACE_SNAPSHOT_RETRY_COOLDOWN_MS,
      });
    };
    void refreshProviders({
      environmentId,
      input: { instanceId: selectedProviderInstanceId, cwd: projectCwd },
    }).then((result) => {
      const refreshed =
        result._tag === "Success" &&
        hasCompleteProviderWorkspaceSnapshot(
          result.value.providers.find(
            (provider) => provider.instanceId === selectedProviderInstanceId,
          ),
          projectCwd,
        );
      if (!refreshed) retryLater();
    }, retryLater);
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- draftMessage changes retry the workspace refresh
    draftMessage,
    environmentId,
    projectCwd,
    refreshProviders,
    selectedProviderInstanceId,
    selectedProviderStatus,
    workspaceRefreshRetry,
  ]);

  const showSkillsInSlashMenu = useAtomValue(showSkillsInSlashMenuAtom);
  const trigger = (() => {
    if (!enabled || selection.start !== selection.end) {
      return null;
    }
    return detectComposerTrigger(draftMessage, selection.end);
  })();
  const pathSearch = useComposerPathSearch({
    environmentId,
    cwd: trigger?.kind === "path" ? projectCwd : null,
    query: trigger?.kind === "path" ? trigger.query : null,
  });
  // Mounts older done threads matching the mention, which shells may leave out.
  useThreadSearch(
    trigger?.kind === "path" && environmentId ? [environmentId] : [],
    trigger?.kind === "path" ? trigger.query : "",
    { titlesOnly: true },
  );
  const pullRequestSearch = useComposerPullRequestSearch({
    environmentId,
    projectId: pullRequestProjectId,
    repository: pullRequestRepository,
    threadPullRequests,
    query: trigger?.kind === "pull-request" ? trigger.query : null,
  });

  const items = ((): ComposerCommandItem[] => {
    if (!trigger) return [];

    if (trigger.kind === "pull-request") {
      return pullRequestSearch.entries.map((entry) => ({
        id: `pr:${entry.projectId}:${entry.repository}:${entry.number}`,
        type: "pull-request",
        pullRequest: {
          number: entry.number,
          title: entry.title,
          url: entry.url,
          headBranch: entry.headBranch,
          baseBranch: entry.baseBranch,
          state: entry.state,
          isDraft: entry.isDraft,
        },
        label: `#${entry.number}`,
        description: `${entry.isDraft ? "Draft" : entry.state} · ${
          entry.repository.toLowerCase() === pullRequestRepository?.toLowerCase()
            ? ""
            : `${entry.repository} · `
        }${entry.title}`,
      }));
    }

    if (trigger.kind === "slash-command") {
      const q = trigger.query.toLowerCase();
      const visibleSkills = getProviderSkillsForSlashMenu(skills, showSkillsInSlashMenu);
      const commandItems = buildComposerSlashCommandItems({
        query: q,
        hasThread,
        hasCompactableConversation,
        offersUsageLimits,
        selectedProviderStatus: selectedProviderStatus
          ? {
              ...selectedProviderStatus,
              slashCommands: getProviderSlashCommandsForSlashMenu(
                resolveProviderSlashCommandsForCwd(selectedProviderStatus, projectCwd),
                visibleSkills,
              ),
            }
          : null,
      });

      const skillItems = visibleSkills
        .filter((skill) => matchesCommandMenuSkillQuery(skill, q))
        .map((skill) => ({
          id: `skill:${skill.name}`,
          type: "skill" as const,
          skill,
          label: `skill:${skill.name}`,
          description: skill.shortDescription ?? skill.description ?? "",
        }));

      return [...commandItems, ...skillItems];
    }

    if (trigger.kind === "skill" || (trigger.kind === "slash-skill" && showSkillsInSlashMenu)) {
      const enabledSkills = dedupeProviderSkillsByName(skills.filter(isProviderSkillUserInvocable));
      const normalizedQuery = normalizeSearchQuery(trigger.query, {
        trimLeadingPattern: /^\p{Sc}+/u,
      });

      if (!normalizedQuery) {
        return enabledSkills.slice(0, 20).map((skill) => ({
          id: `skill:${skill.name}`,
          type: "skill" as const,
          skill,
          label: skill.displayName ?? skill.name,
          description: skill.shortDescription ?? skill.description ?? "",
        }));
      }

      const ranked: Array<{
        item: (typeof enabledSkills)[number];
        score: number;
        tieBreaker: string;
      }> = [];
      for (const skill of enabledSkills) {
        const displayLabel = (skill.displayName ?? skill.name).toLowerCase();
        const scores = [
          scoreQueryMatch({
            value: skill.name.toLowerCase(),
            query: normalizedQuery,
            exactBase: 0,
            prefixBase: 2,
            boundaryBase: 4,
            includesBase: 6,
            fuzzyBase: 100,
            boundaryMarkers: ["-", "_", "/"],
          }),
          scoreQueryMatch({
            value: displayLabel,
            query: normalizedQuery,
            exactBase: 1,
            prefixBase: 3,
            boundaryBase: 5,
            includesBase: 7,
            fuzzyBase: 110,
          }),
          scoreQueryMatch({
            value: skill.shortDescription?.toLowerCase() ?? "",
            query: normalizedQuery,
            exactBase: 20,
            prefixBase: 22,
            boundaryBase: 24,
            includesBase: 26,
          }),
          scoreQueryMatch({
            value: skill.description?.toLowerCase() ?? "",
            query: normalizedQuery,
            exactBase: 30,
            prefixBase: 32,
            boundaryBase: 34,
            includesBase: 36,
          }),
        ].filter((score): score is number => score !== null);

        if (scores.length > 0) {
          insertRankedSearchResult(
            ranked,
            {
              item: skill,
              score: Math.min(...scores),
              tieBreaker: `${displayLabel}\u0000${skill.name}`,
            },
            20,
          );
        }
      }

      return ranked.map(({ item: skill }) => ({
        id: `skill:${skill.name}`,
        type: "skill" as const,
        skill,
        label: skill.displayName ?? skill.name,
        description: skill.shortDescription ?? skill.description ?? "",
      }));
    }

    if (trigger.kind === "path") {
      const threadItems = environmentId
        ? matchComposerThreadItems({
            shells: threadShells,
            environmentId,
            excludeThreadId: currentThreadId,
            query: trigger.query,
            now,
          })
        : [];
      return [
        ...threadItems,
        ...pathSearch.entries.map((entry) => {
          const parts = entry.path.split("/");
          return {
            id: `path:${entry.path}`,
            type: "path" as const,
            path: entry.path,
            kind: entry.kind,
            label: parts[parts.length - 1] ?? entry.path,
            description: parts.length > 1 ? parts.slice(0, -1).join("/") : "",
          };
        }),
      ];
    }

    return [];
  })();

  const onSelect = (item: ComposerCommandItem) => {
    if (!trigger) return;
    if (item.type === "thread") {
      if (!ownerKey || trigger.kind !== "path") return;
      const shell = threadShells.find(
        (candidate) =>
          candidate.environmentId === item.thread.environmentId &&
          candidate.id === item.thread.threadId,
      );
      if (!shell) return;
      const record = threadComposerContext(item.thread, shell.title);
      const existing = getComposerDraftSnapshot(ownerKey).context?.records ?? [];
      const alreadyAttached = existing.some((entry) => entry.contextId === record.contextId);
      if (!alreadyAttached && existing.length >= COMPOSER_CONTEXT_MAX_RECORDS) {
        Dialog.alert("Too many context items", "Remove some context from the draft and try again.");
        return;
      }
      const result = replaceTextRange(
        draftMessage,
        trigger.rangeStart,
        trigger.rangeEnd,
        `${formatComposerContextReference(record)} `,
      );
      onChangeDraftMessage(result.text);
      if (!alreadyAttached) {
        const draft = getComposerDraftSnapshot(ownerKey);
        setComposerDraftContext(ownerKey, {
          version: 1,
          records: [...(draft.context?.records ?? []), record],
        });
      }
      setSelection({ start: result.cursor, end: result.cursor });
      return;
    }
    if (item.type === "pull-request") {
      if (
        !ownerKey ||
        trigger.kind !== "pull-request" ||
        !items.some((candidate) => candidate.id === item.id)
      )
        return;
      const record = pullRequestComposerContext(item.pullRequest, uuidv4());
      if (
        (getComposerDraftSnapshot(ownerKey).context?.records.length ?? 0) >=
        COMPOSER_CONTEXT_MAX_RECORDS
      ) {
        Dialog.alert("Too many context items", "Remove some context from the draft and try again.");
        return;
      }
      const result = replaceTextRange(
        draftMessage,
        trigger.rangeStart,
        trigger.rangeEnd,
        `${formatComposerContextReference(record)} `,
      );
      onChangeDraftMessage(result.text);
      const draft = getComposerDraftSnapshot(ownerKey);
      setComposerDraftContext(ownerKey, {
        version: 1,
        records: [...(draft.context?.records ?? []), record],
      });
      setSelection({ start: result.cursor, end: result.cursor });
      return;
    }

    if (
      item.type === "provider-slash-command" &&
      item.command.name === USAGE_LIMITS_COMMAND.name &&
      onUsageLimits
    ) {
      const cleared = replaceTextRange(draftMessage, trigger.rangeStart, trigger.rangeEnd, "");
      setSelection({ start: cleared.cursor, end: cleared.cursor });
      onChangeDraftMessage(cleared.text);
      onUsageLimits();
      return;
    }

    const result = resolveComposerCommandSelection({
      draftMessage,
      trigger,
      item,
    });
    setSelection({ start: result.cursor, end: result.cursor });
    onChangeDraftMessage(result.text);
  };

  return {
    selection,
    onSelectionChange,
    trigger,
    items,
    skills,
    isLoading:
      trigger?.kind === "pull-request" ? pullRequestSearch.isPending : pathSearch.isPending,
    error:
      trigger?.kind === "pull-request"
        ? pullRequestProjectId === null || pullRequestRepository === null
          ? "Pull requests are unavailable for this project."
          : pullRequestSearch.error
        : null,
    onSelect,
  };
}
