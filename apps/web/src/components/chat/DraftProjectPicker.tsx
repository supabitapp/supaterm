import type { DraftId } from "~/composerDraftStore";
import {
  useComposerDraftStore,
  composerDraftHasUserContent,
  draftThreadHasOpenPreview,
} from "~/composerDraftStore";
import { resolveEnvironmentMachineKind, type ScopedProjectRef } from "@supaterm/contracts";
import { scopedProjectKey, scopeProjectRef } from "@supaterm/client-runtime/environment";
import { isScratchProject } from "@supaterm/client-runtime/state/projects";
import { ChevronDownIcon, FolderIcon, FolderPlusIcon, MessageSquareDashedIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useComposerHandleContext } from "~/composerHandleContext";
import { shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useClientSettings } from "~/hooks/useSettings";
import { usePickerShortcuts } from "~/hooks/usePickerShortcuts";
import { hasExplicitComposerModelSelection } from "~/lib/chatThreadActions";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
  projectGroupsSpanEnvironments,
} from "~/sidebarProjectGrouping";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { ComposerContextLabel } from "../ComposerContextLabel";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import {
  Combobox,
  ComboboxTrigger,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "../ui/combobox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Kbd } from "../ui/kbd";
import { ComposerControl } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { resolveProjectSettings } from "@supaterm/shared/projectSettings";
import { normalizeSearchQuery, scoreQueryMatch } from "@supaterm/shared/searchRanking";

// Menu value for "No project"; real entries are keyed by logical project key.
const NO_PROJECT_VALUE = "no-project";

interface DraftProjectPickerProps {
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

// The picker's handlers pass catalog entries to plain functions after later hooks, so the
// catalog is derived in its own hook, where the compiler can cache it.
function useDraftProjectCatalog(activeProjectRef: ScopedProjectRef | null) {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const projectGroups = sortLogicalProjectsForSidebar(
    buildSidebarProjectSnapshots({
      projects,
      settings: projectGroupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
    }),
    threads,
    projectSortOrder,
  );
  const projectPickerEntries = buildSidebarProjectPickerEntries({
    groups: projectGroups,
    preferredProjectRef: activeProjectRef,
  });
  return {
    projects,
    environments,
    primaryEnvironmentId,
    projectGroupingSettings,
    projectGroups,
    projectPickerEntries,
    projectEntryByKey: new Map(
      projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const),
    ),
    // Same-named projects on two machines are only told apart by where they
    // live, so rows on another machine carry its icon once the catalog spans
    // more than one environment; a single-machine catalog stays as it was.
    showProjectEnvironments: projectGroupsSpanEnvironments(projectGroups),
    environmentMachineById: new Map(
      environments.map(
        (environment) =>
          [
            environment.environmentId,
            resolveEnvironmentMachineKind(environment.serverConfig),
          ] as const,
      ),
    ),
  };
}

/** The composer strip's project control for a new draft; it retargets the draft in place. */
export function DraftProjectPicker({
  draftId,
  activeProjectRef,
  activeProjectTitle,
}: DraftProjectPickerProps) {
  const {
    projects,
    environments,
    primaryEnvironmentId,
    projectGroupingSettings,
    projectGroups,
    projectPickerEntries,
    projectEntryByKey,
    showProjectEnvironments,
    environmentMachineById,
  } = useDraftProjectCatalog(activeProjectRef);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const applyStickyState = useComposerDraftStore((store) => store.applyStickyState);
  const setModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const openAddProject = () => openCommandPalette({ open: "add-project" });
  const { scratchEnvironmentId, scratchWorkspaceRootFor, openScratchProject } = useScratchProject();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const projectPickerShortcut = shortcutLabelForCommand(keybindings, "projectPicker.toggle");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const composerRef = useComposerHandleContext();
  const composerMenuProps = useComposerMenuProps();
  const pickerRef = useRef<HTMLDivElement>(null);

  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const activeProjectDisplayName = activeProjectGroup?.displayName ?? activeProjectTitle;
  const canChooseProject = projectPickerEntries.length > 0;
  // The project that hosts threads without a project appears once, as the
  // "No project" item, not as a project row.
  const menuEntries = projectPickerEntries.filter(
    ({ targetProject }) =>
      !isScratchProject(targetProject, scratchWorkspaceRootFor(targetProject.environmentId)),
  );
  const activeProject =
    activeProjectRef === null
      ? null
      : (projects.find(
          (project) =>
            project.environmentId === activeProjectRef.environmentId &&
            project.id === activeProjectRef.projectId,
        ) ?? null);
  const scratchTargetEnvironmentId = scratchEnvironmentId(
    activeProjectRef?.environmentId ?? primaryEnvironmentId,
  );
  const scratchWorkspaceRoot = scratchWorkspaceRootFor(scratchTargetEnvironmentId);
  const isScratchDraft =
    activeProject !== null && isScratchProject(activeProject, scratchWorkspaceRoot);

  // The picker can change the draft's target while the no-project home is
  // still being opened; a stale continuation must not retarget it again.
  const latestTargetRef = useRef({ draftId, activeProjectKey, scratchTargetEnvironmentId });
  useEffect(() => {
    latestTargetRef.current = { draftId, activeProjectKey, scratchTargetEnvironmentId };
  }, [activeProjectKey, scratchTargetEnvironmentId, draftId]);
  // Project selection changes the target of the open draft in place. The
  // prompt stays in the same composer session, so the sidebar only gets a
  // draft row if the user later navigates away.
  const openProjectDraft = useNewThreadHandler();
  const selectProject = (project: (typeof projects)[number], logicalProjectKey: string) => {
    if (!draftId) {
      return;
    }
    latestTargetRef.current = {
      draftId,
      activeProjectKey: logicalProjectKey,
      scratchTargetEnvironmentId: project.environmentId,
    };
    const currentDraft = getComposerDraft(draftId);
    if (
      !composerDraftHasUserContent(currentDraft) &&
      draftThreadHasOpenPreview(useComposerDraftStore.getState().getDraftSession(draftId))
    ) {
      void openProjectDraft(scopeProjectRef(project.environmentId, project.id));
      return;
    }
    setLogicalProjectDraftThreadId(
      logicalProjectKey,
      scopeProjectRef(project.environmentId, project.id),
      draftId,
    );
    if (!hasExplicitComposerModelSelection(currentDraft)) {
      applyStickyState(draftId);
      const environmentSettings = environments.find(
        (environment) => environment.environmentId === project.environmentId,
      )?.serverConfig?.settings;
      const defaultModelSelection = environmentSettings
        ? resolveProjectSettings(environmentSettings, project.id, project).settings
            .defaultModelSelection
        : project.defaultModelSelection;
      if (defaultModelSelection) {
        setModelSelection(draftId, defaultModelSelection, {
          replaceOptions: true,
        });
      }
    }
  };
  // Moves the draft to No project. Focus goes to the prompt unless the user has
  // already moved it elsewhere while the folder was being prepared.
  const startScratch = async () => {
    if (scratchTargetEnvironmentId === null || isScratchDraft) {
      return;
    }
    const requested = { draftId, activeProjectKey, scratchTargetEnvironmentId };
    const project = await openScratchProject(scratchTargetEnvironmentId);
    const latest = latestTargetRef.current;
    if (
      !project ||
      latest.draftId !== requested.draftId ||
      latest.activeProjectKey !== requested.activeProjectKey ||
      latest.scratchTargetEnvironmentId !== requested.scratchTargetEnvironmentId
    ) {
      return;
    }
    selectProject(project, deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings));
    const activeElement = document.activeElement;
    if (activeElement === document.body || pickerRef.current?.contains(activeElement)) {
      composerRef?.current?.focusAtEnd();
    }
  };

  const noProjectItem =
    scratchWorkspaceRoot === null ? undefined : { value: NO_PROJECT_VALUE, label: "No project" };
  const pickerItems = [
    ...(noProjectItem ? [noProjectItem] : []),
    ...menuEntries.map(({ group }) => ({ value: group.projectKey, label: group.displayName })),
    { value: "add-project", label: "Add project" },
  ];
  const pickerQuery = normalizeSearchQuery(projectQuery);
  const filteredPickerItems = pickerQuery
    ? pickerItems
        .flatMap((item) => {
          const entry = projectEntryByKey.get(item.value);
          const searchText = [
            item.label,
            ...(entry?.group.memberProjects.map((project) => project.workspaceRoot) ?? []),
          ]
            .join(" ")
            .toLowerCase();
          const score = scoreQueryMatch({
            value: searchText,
            query: pickerQuery,
            exactBase: 0,
            prefixBase: 10,
            boundaryBase: 20,
            includesBase: 40,
            fuzzyBase: 100,
          });
          return score === null ? [] : [{ item, score }];
        })
        .toSorted((left, right) => left.score - right.score)
        .map((result) => result.item)
    : pickerItems;
  const selectPickerItem = (item: (typeof pickerItems)[number]) => {
    if (item.value === "add-project") {
      openAddProject();
      return;
    }
    if (item.value === NO_PROJECT_VALUE) {
      void startScratch();
      return;
    }
    const entry = projectEntryByKey.get(item.value);
    if (entry && item.value !== activeProjectKey)
      selectProject(entry.targetProject, entry.group.projectKey);
  };
  const projectJumpLabels = usePickerShortcuts({
    picker: "project",
    open: projectMenuOpen,
    items: filteredPickerItems.filter((item) => projectEntryByKey.has(item.value)),
    fixedChoice: noProjectItem
      ? { item: noProjectItem, command: "projectPicker.noProject" }
      : undefined,
    keybindings,
    onSelect: (item) => {
      selectPickerItem(item);
      setProjectMenuOpen(false);
      setProjectQuery("");
      composerRef?.current?.focusAtEnd();
    },
  });
  const triggerLabel = isScratchDraft
    ? "No project"
    : (activeProjectDisplayName ?? "Choose a project");

  if (!canChooseProject) {
    return (
      <ComposerControl
        size="xs"
        className="min-w-0"
        data-composer-context-control
        onClick={openAddProject}
      >
        <FolderPlusIcon className="size-3 shrink-0" />
        <ComposerContextLabel>{activeProjectTitle ?? "Add project"}</ComposerContextLabel>
      </ComposerControl>
    );
  }

  return (
    <div ref={pickerRef} className="flex min-w-0" data-composer-context-control>
      <Combobox
        items={pickerItems}
        filteredItems={filteredPickerItems}
        filter={null}
        itemToStringLabel={(item) => item.label}
        itemToStringValue={(item) => item.value}
        autoHighlight
        value={
          pickerItems.find(
            (item) => item.value === (isScratchDraft ? NO_PROJECT_VALUE : activeProjectKey),
          ) ?? null
        }
        onValueChange={(item) => {
          if (!item) return;
          selectPickerItem(item);
        }}
        open={projectMenuOpen}
        onOpenChange={(open) => {
          setProjectMenuOpen(open);
          if (!open) setProjectQuery("");
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <ComboboxTrigger
                render={<ComposerControl size="xs" />}
                aria-label={`Project: ${triggerLabel}`}
                data-draft-project-trigger=""
                className="min-w-0 max-w-full active:scale-100"
              />
            }
          >
            {isScratchDraft ? (
              <MessageSquareDashedIcon className="size-3 shrink-0" />
            ) : activeProjectGroup ? (
              <ProjectFavicon project={activeProjectGroup} className="size-3 shrink-0" />
            ) : (
              <FolderIcon className="size-3 shrink-0" />
            )}
            <ComposerContextLabel>{triggerLabel}</ComposerContextLabel>
            <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
          </TooltipTrigger>
          <TooltipPopup shortcut={projectPickerShortcut}>Select project</TooltipPopup>
        </Tooltip>
        <ComboboxPopup side="top" align="start" {...composerMenuProps}>
          <ComboboxSearchInput
            autoFocus
            aria-label="Search projects"
            placeholder="Search projects..."
            value={projectQuery}
            onChange={(event) => setProjectQuery(event.target.value)}
          />
          <ComboboxEmpty>No projects found.</ComboboxEmpty>
          <ComboboxList>
            {(item: (typeof pickerItems)[number]) => {
              const entry = projectEntryByKey.get(item.value);
              return (
                <ComboboxItem key={item.value} value={item}>
                  {entry ? (
                    <ProjectFavicon project={entry.group} className="size-4 shrink-0" />
                  ) : item.value === NO_PROJECT_VALUE ? (
                    <MessageSquareDashedIcon className="size-4 shrink-0" />
                  ) : (
                    <FolderPlusIcon className="size-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {entry && showProjectEnvironments ? (
                    <ProjectEnvironmentBadge
                      group={entry.group}
                      primaryEnvironmentId={primaryEnvironmentId}
                      machineByEnvironmentId={environmentMachineById}
                    />
                  ) : null}
                  {projectJumpLabels.has(item) ? (
                    <Kbd variant="plain" aria-hidden>
                      {projectJumpLabels.get(item)}
                    </Kbd>
                  ) : null}
                </ComboboxItem>
              );
            }}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}
