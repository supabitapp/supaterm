import { useClientSettings } from "../../hooks/useSettings";
import { resolveThreadDetailsVisibility, THREAD_DETAILS_ITEMS } from "./threadDetailsItems";
import { ThreadDetailsItemsMenuItems } from "./ThreadDetailsItemsMenu";
import { ThreadDetailsProviderLimits } from "./ThreadDetailsProviderLimits";
import { ThreadServersPanel } from "./ThreadServersPanel";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Button } from "../ui/button";
import { SlidersHorizontalIcon } from "@supaterm/icons";
import type {
  EditorId,
  EnvironmentId,
  ProjectId,
  ProjectScript,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
  ThreadId,
} from "@supaterm/contracts";

import type { DraftId } from "../../composerDraftStore";
import { useSupatermProjectFileScripts } from "../../hooks/useSupatermProjectFileScripts";
import {
  shouldShowEnvironmentIndicator,
  type EnvMode,
  type EnvironmentOption,
} from "../BranchToolbar.logic";
import { BranchToolbar } from "../BranchToolbar";
import { BranchToolbarEnvironmentSelector } from "../BranchToolbarEnvironmentSelector";
import BaseGitActionsControl from "../GitActionsControl";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { memo, type ComponentProps } from "react";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { OpenInPicker } from "./OpenInPicker";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadAutomationsPanel } from "./ThreadAutomationsPanel";
import { ThreadRelationshipsPanel } from "./ThreadRelationshipsControl";
import { ThreadDetailsUsage } from "./ThreadDetailsUsage";
import { ThreadDetailsForkControl } from "./ThreadDetailsForkControl";

const GitActionsControl = memo(BaseGitActionsControl);

export interface ThreadDetailsPanelProps extends Pick<
  ComponentProps<typeof ThreadDetailsCard>,
  "anchor" | "handle" | "onPresentationChange"
> {
  forceNewWorktree?: boolean;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  projectId: ProjectId;
  worktreePath: string | null;
  isServerThread: boolean;
  draftId?: DraftId;
  composerDraftTarget: ScopedThreadRef | DraftId;
  activeProjectName: string | undefined;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  showOpenInPicker: boolean;
  openInShortcutEnabled: boolean;
  gitCwd: string | null;
  isGitRepo: boolean;
  envLocked: boolean;
  availableEnvironments: readonly EnvironmentOption[];
  autoEnvironmentLabel?: string | undefined;
  onAutoEnvironment?: (() => void) | undefined;
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  onEnvModeChange: (mode: EnvMode) => void;
  envMode: EnvMode;
  activeThreadBranchOverride?: string | null;
  startFromOrigin: boolean;
  onStartFromOriginChange: (startFromOrigin: boolean) => void;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest: () => void;
  onOpenChanges?: () => void;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
  providerLimits?: ComponentProps<typeof ThreadDetailsProviderLimits>;
  contextWindow?: ComponentProps<typeof ThreadDetailsUsage>["contextWindow"];
  forkSource?: ComponentProps<typeof ThreadDetailsForkControl>["source"] | null;
  forkDisabled?: boolean;
  onForkFromRun?: ComponentProps<typeof ThreadDetailsForkControl>["onForkFromRun"];
}

export function ThreadDetailsPanel(props: ThreadDetailsPanelProps) {
  const visible = useClientSettings(resolveThreadDetailsVisibility);
  const fileScripts = useSupatermProjectFileScripts(
    props.environmentId,
    props.activeProjectScripts && visible.scripts ? props.gitCwd : null,
  );
  // Same rule as the composer strip: a lone remote machine still gets a row,
  // shown as a static label because there is nothing to pick.
  const canPickEnvironment = props.availableEnvironments.length > 1;
  const showEnvironment = shouldShowEnvironmentIndicator({
    activeEnvironment:
      props.availableEnvironments.find((env) => env.environmentId === props.environmentId) ?? null,
    canPickEnvironment,
  });
  const activeThreadRef = { environmentId: props.environmentId, threadId: props.threadId };
  const branchToolbarProps = {
    showGitControls: props.isGitRepo,
    environmentId: props.environmentId,
    threadId: props.threadId,
    projectId: props.projectId,
    worktreePath: props.worktreePath,
    isServerThread: props.isServerThread,
    ...(props.draftId ? { draftId: props.draftId } : {}),
    composerDraftTarget: props.composerDraftTarget,
    onEnvModeChange: props.onEnvModeChange,
    startFromOrigin: props.startFromOrigin,
    onStartFromOriginChange: props.onStartFromOriginChange,
    envMode: props.envMode,
    ...(props.activeThreadBranchOverride !== undefined
      ? { activeThreadBranchOverride: props.activeThreadBranchOverride }
      : {}),
    envLocked: props.envLocked,
    forceNewWorktree: props.forceNewWorktree ?? false,
    onComposerFocusRequest: props.onComposerFocusRequest,
    ...(props.onCheckoutPullRequestRequest
      ? { onCheckoutPullRequestRequest: props.onCheckoutPullRequestRequest }
      : {}),
  };

  return (
    <ThreadDetailsCard
      threadRef={{ environmentId: props.environmentId, threadId: props.threadId }}
      anchor={props.anchor}
      handle={props.handle}
      onPresentationChange={props.onPresentationChange}
      contentKey={THREAD_DETAILS_ITEMS.filter((item) => visible[item.id])
        .map((item) => item.id)
        .join(",")}
    >
      {(density) => (
        <>
          <div className="flex justify-end px-2 pt-1">
            <Menu>
              <MenuTrigger
                render={
                  <Button variant="ghost" size="icon-xs" aria-label="Choose thread details" />
                }
              >
                <SlidersHorizontalIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                <ThreadDetailsItemsMenuItems />
              </MenuPopup>
            </Menu>
          </div>
          <ThreadDetailsSection
            headingId="thread-details-workspace-heading"
            title="Workspace"
            separated={false}
            showHeading={false}
          >
            <div className="flex flex-col">
              {density === "full" && visible.environment && showEnvironment ? (
                <BranchToolbarEnvironmentSelector
                  displayMode="panel"
                  autoEnvironmentLabel={props.autoEnvironmentLabel}
                  onAutoEnvironment={props.onAutoEnvironment}
                  envLocked={props.envLocked}
                  environmentId={props.environmentId}
                  availableEnvironments={props.availableEnvironments}
                  {...(canPickEnvironment
                    ? { onEnvironmentChange: props.onEnvironmentChange }
                    : {})}
                />
              ) : null}

              {density !== "essential" && visible.openIn && props.showOpenInPicker ? (
                <OpenInPicker
                  keybindings={props.keybindings}
                  environmentId={props.environmentId}
                  availableEditors={props.availableEditors}
                  openInCwd={props.gitCwd}
                  enableShortcut={props.openInShortcutEnabled}
                  displayMode="panel"
                />
              ) : null}

              {visible.scripts && props.activeProjectScripts ? (
                <ProjectScriptsControl
                  environmentId={props.environmentId}
                  displayMode="panel"
                  scripts={props.activeProjectScripts}
                  fileScripts={fileScripts}
                  preferredScriptId={props.preferredScriptId}
                  onRunScript={props.onRunProjectScript}
                  onAddScript={props.onAddProjectScript}
                  onUpdateScript={props.onUpdateProjectScript}
                  onDeleteScript={props.onDeleteProjectScript}
                />
              ) : null}
            </div>
          </ThreadDetailsSection>

          {props.gitCwd && (visible.branch || visible.gitActions || visible.changes) ? (
            <ThreadDetailsSection
              headingId="thread-details-version-control-heading"
              title="Version Control"
              showHeading={false}
              separated={density === "full"}
            >
              <div className="flex flex-col">
                {visible.branch && props.isGitRepo ? (
                  <BranchToolbar layout="panel" panelSection="branch" {...branchToolbarProps} />
                ) : null}
                {(visible.gitActions || visible.changes) && props.activeProjectName ? (
                  <GitActionsControl
                    displayMode="panel"
                    showActions={visible.gitActions}
                    showChanges={visible.changes}
                    compact={density !== "full"}
                    gitCwd={props.gitCwd}
                    activeThreadRef={activeThreadRef}
                    {...(props.draftId ? { draftId: props.draftId } : {})}
                    {...(props.onOpenChanges ? { onOpenChanges: props.onOpenChanges } : {})}
                  />
                ) : null}
              </div>
            </ThreadDetailsSection>
          ) : null}

          {visible.servers && density === "full" && !props.draftId ? (
            <ThreadServersPanel environmentId={props.environmentId} threadId={props.threadId} />
          ) : null}
          {visible.limits && props.providerLimits ? (
            <ThreadDetailsProviderLimits {...props.providerLimits} />
          ) : null}
          {visible.usage && !props.draftId ? (
            <ThreadDetailsUsage contextWindow={props.contextWindow ?? null}>
              {props.forkSource && props.onForkFromRun ? (
                <ThreadDetailsForkControl
                  key={props.threadId}
                  source={props.forkSource}
                  disabled={props.forkDisabled ?? false}
                  onForkFromRun={props.onForkFromRun}
                />
              ) : null}
            </ThreadDetailsUsage>
          ) : null}

          {visible.automations && density === "full" && !props.draftId ? (
            <ThreadAutomationsPanel environmentId={props.environmentId} threadId={props.threadId} />
          ) : null}

          {visible.lineage && density === "full" && !props.draftId ? (
            <ThreadRelationshipsPanel
              environmentId={props.environmentId}
              threadId={props.threadId}
            />
          ) : null}
        </>
      )}
    </ThreadDetailsCard>
  );
}
