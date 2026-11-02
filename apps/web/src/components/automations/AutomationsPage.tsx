import { useAtomValue } from "@effect/atom-react";
import { connectionStatusTitle } from "@supaterm/client-runtime/connection";
import { AsyncResult, Atom } from "effect/reactivity";
import { CircleAlertIcon, Clock3Icon, PlusIcon } from "@supaterm/icons";
import { type ReactNode, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import type { EnvironmentId, ScheduledTask } from "@supaterm/contracts";
import { AuthOrchestrationOperateScope } from "@supaterm/contracts";

import { isElectron } from "../../env";
import { projectGroupMemberKeys, type SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../../state/environments";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { formatEnvironmentQueryError } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ScopeSentence } from "../settings/ScopeSentence";
import { selectScopedSettingsEnvironments } from "../settings/scopedSettings";
import { resolveSettingsScope, type ResolvedSettingsScope } from "../settings/settingsScope";
import { SettingsGroup } from "../settings/SettingsGroup";
import { settingsScopeEnvironmentLabel } from "../settings/settingsScopeAxis";
import { useSettingsProjectGroups } from "../settings/useSettingsProjectGroups";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AutomationEditorDialog } from "./AutomationEditorDialog";
import { AutomationTable, AutomationTableSkeleton } from "./AutomationTable";
import { automationsScopeSearch, matchesAutomationScope } from "./automations.logic";

const route = getRouteApi("/_chat/automations");

/**
 * Every environment's scheduled tasks in one list. The project and environment
 * scope narrows both the list and where a new automation can be created.
 */
export function AutomationsPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const groups = useSettingsProjectGroups();
  const { environments: availableEnvironments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const scope = resolveSettingsScope(search, groups, availableEnvironments);
  const {
    environments,
    connectedEnvironments,
    environment: defaultEnvironment,
  } = selectScopedSettingsEnvironments(scope, availableEnvironments, primaryEnvironmentId);
  const writableEnvironmentIds = useEnvironmentsWithScope(
    connectedEnvironments,
    AuthOrchestrationOperateScope,
  );
  const writableEnvironments = connectedEnvironments.filter((entry) =>
    writableEnvironmentIds.has(entry.environmentId),
  );
  const creationEnvironment =
    writableEnvironments.find(
      (entry) => entry.environmentId === defaultEnvironment?.environmentId,
    ) ?? writableEnvironments[0];
  const projectByKey = new Map(
    groups.flatMap((group) =>
      [...projectGroupMemberKeys(group)].map((key) => [key, group] as const),
    ),
  );
  const [editor, setEditor] = useState<{
    environmentId: EnvironmentId;
    task: ScheduledTask | null;
  } | null>(null);
  const openForEdit = (environmentId: EnvironmentId, task: ScheduledTask) => {
    setEditor({ environmentId, task });
  };
  const openForCreate = (environmentId: EnvironmentId) => {
    if (readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      setEditor({ environmentId, task: null });
    }
  };
  const hasTaskLink = search.environmentId !== undefined || search.taskId !== undefined;
  const closeEditor = () => {
    setEditor(null);
    if (!hasTaskLink) return;
    void navigate({ search: automationsScopeSearch, replace: true });
  };
  const showProject = scope.kind !== "project" && scope.kind !== "checkout";
  const linkEnvironmentId = search.environmentId ?? defaultEnvironment?.environmentId;
  const states = useAutomationEnvironmentStates(environments, scope);
  const linkedState = states.find((state) => state.environment.environmentId === linkEnvironmentId);
  const linkedTask =
    search.taskId === undefined
      ? undefined
      : linkedState?.tasks?.find((task) => task.id === search.taskId);
  const linkUnavailable =
    search.taskId !== undefined &&
    linkedState?.tasks !== undefined &&
    linkedState.error === null &&
    linkedTask === undefined;
  const link = search.taskId === undefined ? null : `${linkEnvironmentId ?? ""}:${search.taskId}`;
  // A `taskId` link opens its editor once, the first time the task loads. The editor then owns
  // the session until close, so a disconnect that drops the task cannot drop unsaved edits.
  // An editor the user already opened wins: a late-loading link must not replace its draft.
  const [openedLink, setOpenedLink] = useState<string | null>(null);
  if (link === null && openedLink !== null) setOpenedLink(null);
  if (link !== null && linkedState && linkedTask && openedLink !== link) {
    setOpenedLink(link);
    if (editor === null) openForEdit(linkedState.environment.environmentId, linkedTask);
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="Automations breadcrumb" className="min-w-0 flex-1">
            <WorkspaceBreadcrumbItem current>
              <h1>Automations</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <Button
            variant="default"
            disabled={!creationEnvironment}
            onClick={() => creationEnvironment && openForCreate(creationEnvironment.environmentId)}
          >
            <PlusIcon />
            New automation
          </Button>
        </WorkspacePageHeader>

        <div className="topbar-scroll-fade scrollbar-gutter-both flex-1 overflow-y-auto">
          <WorkspacePageContainer width="wide">
            <ScopeSentence
              lead="Showing automations for"
              presentation="filters"
              value={search}
              scope={scope}
              groups={groups}
              environments={availableEnvironments}
              onChange={(next) => void navigate({ search: automationsScopeSearch(next) })}
            />
            {scope.kind === "unavailable" ? (
              <p className="text-sm text-muted-foreground">{scope.message}</p>
            ) : states.length > 1 ? (
              <AutomationEnvironmentList
                states={states}
                projectByKey={projectByKey}
                showProject={showProject}
                linkUnavailable={linkUnavailable}
                creationEnvironment={creationEnvironment}
                onCreate={openForCreate}
                onEdit={openForEdit}
              />
            ) : states[0] ? (
              <AutomationEnvironmentSection
                state={states[0]}
                projectByKey={projectByKey}
                showProject={showProject}
                linkUnavailable={linkUnavailable}
                creationEnvironment={creationEnvironment}
                onCreate={openForCreate}
                onEdit={openForEdit}
              />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Clock3Icon />
                  </EmptyMedia>
                  <EmptyTitle>No environments available</EmptyTitle>
                  <EmptyDescription>Connect an environment to manage automations.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </WorkspacePageContainer>
        </div>
      </div>
      {editor ? (
        <AutomationEditorDialog
          key={`${editor.environmentId}:${editor.task?.id ?? "new"}`}
          initialEnvironmentId={editor.environmentId}
          task={editor.task}
          scope={scope}
          connectedEnvironments={writableEnvironments}
          onClose={closeEditor}
        />
      ) : null}
    </SidebarInset>
  );
}

interface AutomationEnvironmentState {
  readonly environment: EnvironmentPresentation;
  readonly connected: boolean;
  readonly tasks: readonly ScheduledTask[] | undefined;
  readonly error: string | null;
}

/** Each environment's scheduled tasks in the scope, from its live subscription while connected. */
function useAutomationEnvironmentStates(
  environments: readonly EnvironmentPresentation[],
  scope: ResolvedSettingsScope,
) {
  return useAtomValue(
    Atom.make((get) =>
      environments.map((environment): AutomationEnvironmentState => {
        const connected =
          environment.connection.phase === "connected" && environment.serverConfig !== null;
        const query = connected
          ? get(
              serverEnvironment.scheduledTasksLive({
                environmentId: environment.environmentId,
                input: {},
              }),
            )
          : null;
        const data = query === null ? null : AsyncResult.getOrElse(query, () => null);
        return {
          environment,
          connected,
          tasks: data?.tasks.filter((task) =>
            matchesAutomationScope(scope, environment.environmentId, task.projectId),
          ),
          error: query?._tag === "Failure" ? formatEnvironmentQueryError(query.cause) : null,
        };
      }),
    ),
  );
}

interface AutomationListProps {
  readonly projectByKey: ReadonlyMap<string, SidebarProjectSnapshot>;
  readonly showProject: boolean;
  /** A linked automation that its loaded environment does not have. */
  readonly linkUnavailable: boolean;
  readonly creationEnvironment: EnvironmentPresentation | undefined;
  readonly onCreate: (environmentId: EnvironmentId) => void;
  readonly onEdit: (environmentId: EnvironmentId, task: ScheduledTask) => void;
}

/**
 * With several environments, every loaded automation shares one table; the
 * rest fold into one status line each for empty, loading, failed, and
 * disconnected environments.
 */
function AutomationEnvironmentList({
  states,
  projectByKey,
  showProject,
  linkUnavailable,
  creationEnvironment,
  onCreate,
  onEdit,
}: AutomationListProps & { readonly states: readonly AutomationEnvironmentState[] }) {
  const environments = states.map((state) => state.environment);
  const loaded = states.flatMap(({ environment, connected, tasks, error }) =>
    connected && error === null && tasks ? [{ environment, tasks }] : [],
  );
  const entries = loaded.flatMap(({ environment, tasks }) =>
    tasks.map((task) => ({
      environmentId: environment.environmentId,
      environmentLabel: settingsScopeEnvironmentLabel(environment, environments),
      task,
      project: projectByKey.get(`${environment.environmentId}:${task.projectId}`) ?? null,
    })),
  );
  const notConnected: string[] = [];
  const loading: string[] = [];
  const failed: string[] = [];
  const empty: string[] = [];
  for (const { environment, connected, tasks, error } of states) {
    const label = settingsScopeEnvironmentLabel(environment, environments);
    if (!connected) {
      notConnected.push(`${label} (${connectionStatusTitle(environment.connection)})`);
    } else if (error !== null) {
      failed.push(`${label}: ${error}`);
    } else if (!tasks) {
      loading.push(label);
    } else if (tasks.length === 0 && entries.length > 0) {
      empty.push(label);
    }
  }
  const summaries = [
    ["Not connected:", notConnected],
    ["Loading automations on", loading],
    ["Could not load automations:", failed],
    ["No automations on", empty],
  ] as const;

  return (
    <>
      {linkUnavailable ? (
        <SettingsGroup>
          <AutomationUnavailableNotice />
        </SettingsGroup>
      ) : null}
      {entries.length > 0 ? (
        <SettingsGroup>
          <AutomationTable
            entries={entries}
            showProject={showProject}
            showEnvironment
            onEdit={onEdit}
          />
        </SettingsGroup>
      ) : loaded.length > 0 ? (
        <SettingsGroup>
          <NoAutomationsNotice
            description="Schedule a prompt to keep work moving."
            creationEnvironment={creationEnvironment}
            onCreate={onCreate}
          />
        </SettingsGroup>
      ) : null}
      {summaries.map(([label, labels]) => {
        if (labels.length === 0) return null;
        const summary = `${label} ${labels.join(", ")}`;
        return (
          <Tooltip key={label}>
            <TooltipTrigger
              render={<p className="truncate px-1 text-xs text-muted-foreground" role="status" />}
            >
              {summary}
            </TooltipTrigger>
            <TooltipPopup>{summary}</TooltipPopup>
          </Tooltip>
        );
      })}
    </>
  );
}

function AutomationEnvironmentSection({
  state: { environment, connected, tasks, error },
  projectByKey,
  showProject,
  linkUnavailable,
  creationEnvironment,
  onCreate,
  onEdit,
}: AutomationListProps & { readonly state: AutomationEnvironmentState }) {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={environment.label}>
      <h2 className="sr-only">{environment.label}</h2>
      {linkUnavailable ? (
        <SettingsGroup>
          <AutomationUnavailableNotice />
        </SettingsGroup>
      ) : null}
      <SettingsGroup>
        {!connected ? (
          <AutomationNotice
            title="Environment disconnected"
            description={`Reconnect ${environment.label} to view its automations.`}
          />
        ) : error !== null ? (
          <AutomationNotice title="Could not load automations" description={error} error />
        ) : !tasks ? (
          <div role="status" aria-label="Loading automations">
            <span className="sr-only">Loading automations…</span>
            <AutomationTableSkeleton />
          </div>
        ) : tasks.length === 0 ? (
          <NoAutomationsNotice
            description="Schedule a prompt to keep work moving in this environment."
            creationEnvironment={creationEnvironment}
            onCreate={onCreate}
          />
        ) : (
          <AutomationTable
            entries={tasks.map((task) => ({
              environmentId: environment.environmentId,
              environmentLabel: environment.label,
              task,
              project: projectByKey.get(`${environment.environmentId}:${task.projectId}`) ?? null,
            }))}
            showProject={showProject}
            showEnvironment={false}
            onEdit={onEdit}
          />
        )}
      </SettingsGroup>
    </section>
  );
}

function AutomationUnavailableNotice() {
  return (
    <AutomationNotice
      title="Automation unavailable"
      description="This automation no longer exists or is outside the selected project."
    />
  );
}

function NoAutomationsNotice({
  description,
  creationEnvironment,
  onCreate,
}: {
  readonly description: string;
  readonly creationEnvironment: EnvironmentPresentation | undefined;
  readonly onCreate: (environmentId: EnvironmentId) => void;
}) {
  return (
    <AutomationNotice
      title="No automations yet"
      description={description}
      action={
        creationEnvironment ? (
          <Button
            variant="outline"
            aria-label={`Create automation on ${creationEnvironment.label}`}
            onClick={() => onCreate(creationEnvironment.environmentId)}
          >
            <PlusIcon />
            Create automation
          </Button>
        ) : null
      }
    />
  );
}

function AutomationNotice({
  title,
  description,
  action,
  error = false,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly error?: boolean;
}) {
  const Icon = error ? CircleAlertIcon : Clock3Icon;
  return (
    <div className="flex min-h-36 flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-5">
      <div className="flex min-w-0 items-start gap-3" role="status">
        <Icon
          aria-hidden
          className={`mt-0.5 size-4 shrink-0 ${error ? "text-destructive" : "text-muted-foreground"}`}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="max-w-[65ch] text-xs leading-5 text-muted-foreground wrap-anywhere">
            {description}
          </p>
        </div>
      </div>
      {action}
    </div>
  );
}
