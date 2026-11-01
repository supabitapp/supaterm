import { settingsScopeEnvironmentLabels } from "./settingsScopeAxis";
import { Spinner } from "~/components/ui/spinner";
import { ArchiveIcon, ArchiveXIcon, SearchIcon, TrashIcon, XIcon } from "@supaterm/icons";
import { scopeThreadRef, scopedThreadKey } from "@supaterm/client-runtime/environment";
import { presentThreadShell } from "@supaterm/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { useSettingsScope } from "./SettingsScopeContext";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useClientSettings } from "../../hooks/useSettings";
import { readLocalApi } from "../../localApi";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { RelativeTime } from "../RelativeTime";
import { deleteSelectedThreadEntries } from "../../lib/threadBatchDelete";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Separator } from "../ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  EMPTY_ROW_SELECTION,
  type RowSelection,
  selectRow,
  setRowsSelected,
} from "./ArchivedThreadsPanel.logic";

function toastFailure(title: string, failure: AsyncResult.Failure<unknown, unknown>) {
  if (isAtomCommandInterrupted(failure)) return;
  const error = squashAtomCommandFailure(failure);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

function threadCount(count: number) {
  return `${count} thread${count === 1 ? "" : "s"}`;
}

export function ArchivedThreadsPanel() {
  const { scope, groups: projectGroups, environments } = useSettingsScope();
  const { unarchiveThreads, deleteThread } = useThreadActions();
  const confirmThreadDelete = useClientSettings((settings) => settings.confirmThreadDelete);
  const {
    snapshots: archivedSnapshots,
    error: archiveError,
    isLoading: isLoadingArchive,
  } = useArchivedThreadSnapshots(scope.environmentIds);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<RowSelection>(EMPTY_ROW_SELECTION);
  const [pendingAction, setPendingAction] = useState<"unarchive" | "delete" | null>(null);

  const { rows, hasMultipleEnvironments } = (() => {
    const selectedProjectKeys =
      scope.kind === "project" || scope.kind === "checkout"
        ? new Set(scope.members.map((member) => `${member.environmentId}:${member.id}`))
        : null;
    const projectsByEnvironmentAndId = new Map(
      archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
        snapshot.projects
          .filter(
            (project) =>
              selectedProjectKeys === null ||
              selectedProjectKeys.has(`${environmentId}:${project.id}`),
          )
          .map(
            (project) => [`${environmentId}:${project.id}`, { ...project, environmentId }] as const,
          ),
      ),
    );
    const environmentLabels = new Map(
      environments.map((environment) => {
        const { primary, secondary } = settingsScopeEnvironmentLabels(environment, environments);
        return [environment.environmentId, secondary ? `${primary} (${secondary})` : primary];
      }),
    );
    const threads = archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
      snapshot.threads.flatMap((thread) => {
        const project = projectsByEnvironmentAndId.get(`${environmentId}:${thread.projectId}`);
        return project ? [{ thread: presentThreadShell(environmentId, thread), project }] : [];
      }),
    );
    const hasMultipleEnvironments =
      new Set(threads.map(({ thread }) => thread.environmentId)).size > 1;
    const logicalGroupsByProjectKey = new Map(
      projectGroups.flatMap((group) =>
        group.memberProjectRefs.map(
          (member) => [`${member.environmentId}:${member.projectId}`, group] as const,
        ),
      ),
    );
    return {
      hasMultipleEnvironments,
      rows: threads
        .map(({ thread, project }) => {
          const ref = scopeThreadRef(thread.environmentId, thread.id);
          const logicalGroup = hasMultipleEnvironments
            ? logicalGroupsByProjectKey.get(`${project.environmentId}:${project.id}`)
            : undefined;
          return {
            key: scopedThreadKey(ref),
            ref,
            title: thread.title,
            archivedAt: thread.archivedAt ?? thread.createdAt,
            createdAt: thread.createdAt,
            project,
            projectTitle: logicalGroup?.displayName ?? project.title,
            environmentLabel: environmentLabels.get(thread.environmentId) ?? thread.environmentId,
          };
        })
        .toSorted(
          (left, right) =>
            right.archivedAt.localeCompare(left.archivedAt) || right.key.localeCompare(left.key),
        ),
    };
  })();
  type ArchivedThreadRow = (typeof rows)[number];

  const showProject = scope.kind !== "project" && scope.kind !== "checkout";
  const needle = query.trim().toLocaleLowerCase();
  const visibleRows =
    needle === ""
      ? rows
      : rows.filter((row) =>
          [row.title, row.projectTitle, row.environmentLabel].some((text) =>
            text.toLocaleLowerCase().includes(needle),
          ),
        );
  const visibleKeys = visibleRows.map((row) => row.key);
  const selectedRows = visibleRows.filter((row) => selection.keys.has(row.key));
  const allVisibleSelected = visibleRows.length > 0 && selectedRows.length === visibleRows.length;
  const columnCount = 5 + (showProject ? 1 : 0) + (hasMultipleEnvironments ? 1 : 0);

  const unarchiveRows = async (targets: readonly ArchivedThreadRow[]) => {
    setPendingAction("unarchive");
    const outcomes = await unarchiveThreads(targets.map((row) => row.ref));
    setPendingAction(null);
    setSelection((current) =>
      setRowsSelected(
        current,
        outcomes.flatMap(({ target, result }) =>
          result._tag === "Success" ? [scopedThreadKey(target)] : [],
        ),
        false,
      ),
    );
    const failure = outcomes.find(({ result }) => result._tag === "Failure")?.result;
    if (failure?._tag === "Failure") {
      toastFailure(`Failed to unarchive ${targets.length === 1 ? "thread" : "threads"}`, failure);
    }
  };

  const deleteRows = async (targets: readonly ArchivedThreadRow[]) => {
    const api = readLocalApi();
    if (confirmThreadDelete && api) {
      const confirmed = await settlePromise(() =>
        api.dialogs.confirm(
          [
            targets.length === 1
              ? `Delete thread "${targets[0]?.title}"?`
              : `Delete ${threadCount(targets.length)}?`,
            "This permanently clears conversation history.",
          ].join("\n"),
          { variant: "destructive" },
        ),
      );
      if (confirmed._tag === "Failure" || !confirmed.value) return;
    }
    setPendingAction("delete");
    const { deletedThreadKeys, firstFailure } = await deleteSelectedThreadEntries({
      entries: targets.map((row) => ({ threadKey: row.key, ref: row.ref })),
      delete: (entry, deletedKeys) => deleteThread(entry.ref, { deletedThreadKeys: deletedKeys }),
    });
    setPendingAction(null);
    setSelection((current) => setRowsSelected(current, [...deletedThreadKeys], false));
    if (firstFailure) {
      toastFailure(`Failed to delete ${targets.length === 1 ? "thread" : "threads"}`, firstFailure);
    }
  };

  const openRowMenu = async (row: ArchivedThreadRow, position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    const targets = selection.keys.has(row.key) && selectedRows.length > 1 ? selectedRows : [row];
    const suffix = targets.length > 1 ? ` (${targets.length})` : "";
    const clicked = await settlePromise(() =>
      api.contextMenu.show(
        [
          { id: "unarchive", label: `Unarchive${suffix}`, disabled: pendingAction !== null },
          {
            id: "delete",
            label: `Delete${suffix}`,
            destructive: true,
            disabled: pendingAction !== null,
          },
        ],
        position,
      ),
    );
    if (clicked._tag === "Failure") {
      toastFailure("Archived thread action failed", clicked);
      return;
    }
    if (clicked.value === "unarchive") await unarchiveRows(targets);
    if (clicked.value === "delete") await deleteRows(targets);
  };

  if (rows.length === 0) {
    return (
      <SettingsPageContainer>
        <SettingsSection
          id={isLoadingArchive ? undefined : searchableSetting("archive").id}
          title={searchableSetting("archive").title}
        >
          <SettingsRow
            title={
              <span className="inline-flex items-center gap-2">
                {isLoadingArchive ? (
                  <Spinner size="sm" tone="muted" />
                ) : (
                  <ArchiveIcon className="size-3.5 text-muted-foreground" />
                )}
                {isLoadingArchive
                  ? "Loading archived threads"
                  : archiveError
                    ? "Could not load archived threads"
                    : "No archived threads"}
              </span>
            }
            description={
              isLoadingArchive
                ? "Checking connected environments."
                : (archiveError ?? "Archived threads will appear here.")
            }
          />
        </SettingsSection>
      </SettingsPageContainer>
    );
  }

  return (
    <SettingsPageContainer>
      <SettingsSection
        id={searchableSetting("archive").id}
        title={searchableSetting("archive").title}
        headerAction={
          <div className="flex items-center gap-3">
            <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
              {needle === "" ? threadCount(rows.length) : `${visibleRows.length} of ${rows.length}`}
            </span>
            <InputGroup className="w-40 sm:w-52">
              <InputGroupAddon>
                <SearchIcon aria-hidden className="size-3" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search archived threads"
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape" || query === "") return;
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery("");
                }}
                placeholder="Search"
                size="sm"
                type="search"
                value={query}
              />
            </InputGroup>
          </div>
        }
      >
        <div className="overflow-hidden rounded-[inherit]">
          <Table aria-label="Archived threads" className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-11">
                  <span className="ms-1 flex size-6 items-center justify-center">
                    <Checkbox
                      aria-label="Select all"
                      checked={allVisibleSelected}
                      disabled={visibleRows.length === 0}
                      indeterminate={selectedRows.length > 0 && !allVisibleSelected}
                      onCheckedChange={() =>
                        setSelection((current) =>
                          setRowsSelected(current, visibleKeys, !allVisibleSelected),
                        )
                      }
                    />
                  </span>
                </TableHead>
                <TableHead>Thread</TableHead>
                {showProject ? (
                  <TableHead className="hidden w-40 sm:table-cell">Project</TableHead>
                ) : null}
                {hasMultipleEnvironments ? (
                  <TableHead className="hidden w-36 sm:table-cell">Environment</TableHead>
                ) : null}
                <TableHead className="w-24 text-right">Archived</TableHead>
                <TableHead className="hidden w-24 text-right sm:table-cell">Created</TableHead>
                <TableHead className="w-11">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="text-center">
                    <span className="block py-6 text-muted-foreground">
                      No archived threads match “{query.trim()}”.
                    </span>
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((row) => {
                  const selected = selection.keys.has(row.key);
                  return (
                    <TableRow
                      key={row.key}
                      className="group/row"
                      data-state={selected ? "selected" : undefined}
                      onMouseDown={(event) => {
                        if (event.shiftKey) event.preventDefault();
                      }}
                      onClick={(event) => {
                        // The checkbox and its hidden input select the row themselves.
                        if (
                          event.target instanceof Element &&
                          event.target.closest("[data-slot=checkbox], input")
                        ) {
                          return;
                        }
                        setSelection((current) =>
                          selectRow(current, row.key, visibleKeys, event.shiftKey),
                        );
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        void openRowMenu(row, { x: event.clientX, y: event.clientY });
                      }}
                    >
                      <TableCell>
                        <span className="ms-1 flex size-6 items-center justify-center">
                          <Checkbox
                            aria-label={`Select ${row.title}`}
                            checked={selected}
                            onCheckedChange={(_checked, details) =>
                              setSelection((current) =>
                                selectRow(
                                  current,
                                  row.key,
                                  visibleKeys,
                                  details.event instanceof MouseEvent && details.event.shiftKey,
                                ),
                              )
                            }
                          />
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="block truncate text-sm text-foreground">{row.title}</span>
                        {showProject || hasMultipleEnvironments ? (
                          <span className="block truncate text-muted-foreground sm:hidden">
                            {[
                              showProject ? row.projectTitle : null,
                              hasMultipleEnvironments ? row.environmentLabel : null,
                            ]
                              .filter((label) => label !== null)
                              .join(" · ")}
                          </span>
                        ) : null}
                      </TableCell>
                      {showProject ? (
                        <TableCell className="hidden sm:table-cell">
                          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                            <ProjectFavicon project={row.project} />
                            <span className="truncate">{row.projectTitle}</span>
                          </span>
                        </TableCell>
                      ) : null}
                      {hasMultipleEnvironments ? (
                        <TableCell className="hidden sm:table-cell">
                          <span className="block truncate text-muted-foreground">
                            {row.environmentLabel}
                          </span>
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right">
                        <span className="tabular-nums text-muted-foreground">
                          <RelativeTime timestamp={row.archivedAt} />
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        <span className="tabular-nums text-muted-foreground">
                          <RelativeTime timestamp={row.createdAt} />
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex justify-end opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  aria-label={`Unarchive ${row.title}`}
                                  disabled={pendingAction !== null}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void unarchiveRows([row]);
                                  }}
                                  size="icon-xs"
                                  type="button"
                                  variant="ghost-muted"
                                >
                                  <ArchiveXIcon />
                                </Button>
                              }
                            />
                            <TooltipPopup side="top">Unarchive</TooltipPopup>
                          </Tooltip>
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </SettingsSection>
      {selectedRows.length > 0 ? (
        <div
          role="toolbar"
          aria-label="Selected archived threads"
          className="sticky bottom-4 flex items-center gap-1 self-center rounded-lg border bg-popover p-1 ps-3 shadow-lg/5 transition-[opacity,translate] duration-150 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none"
        >
          <span className="me-2 text-xs tabular-nums text-muted-foreground">
            {selectedRows.length} selected
          </span>
          <Button
            disabled={pendingAction !== null}
            onClick={() => void unarchiveRows(selectedRows)}
            size="xs"
            type="button"
            variant="ghost"
          >
            {pendingAction === "unarchive" ? <Spinner /> : <ArchiveXIcon />}
            Unarchive
          </Button>
          <Button
            disabled={pendingAction !== null}
            onClick={() => void deleteRows(selectedRows)}
            size="xs"
            type="button"
            variant="ghost-destructive"
          >
            {pendingAction === "delete" ? <Spinner /> : <TrashIcon />}
            Delete
          </Button>
          <Separator orientation="vertical" className="mx-1 h-4" />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Clear selection"
                  onClick={() => setSelection(EMPTY_ROW_SELECTION)}
                  size="icon-xs"
                  type="button"
                  variant="ghost-muted"
                >
                  <XIcon />
                </Button>
              }
            />
            <TooltipPopup side="top">Clear selection</TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
    </SettingsPageContainer>
  );
}
