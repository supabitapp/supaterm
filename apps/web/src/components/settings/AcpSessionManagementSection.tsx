import {
  AuthOrchestrationOperateScope,
  AuthProvidersManageScope,
  AuthOrchestrationReadScope,
} from "@supaterm/contracts";
import { useEnvironmentScope, readEnvironmentScope } from "~/state/session";
import type {
  AcpRegistryConfigurableProvider,
  AcpRegistrySession,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ServerProvider,
} from "@supaterm/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import { useLayoutEffect, useRef, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { InlineConfirmButton } from "../InlineConfirm";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { canStartAcpOperation, type AcpOperation } from "./AcpSessionManagementSection.logic";
import { SettingsRow } from "./settingsLayout";

interface AcpSessionProject {
  readonly id: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
}

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "The ACP operation failed.",
  });
}

function parseProviderHeaders(
  text: string,
):
  | { readonly ok: true; readonly headers: Record<string, string> | undefined }
  | { readonly ok: false; readonly error: string } {
  if (text.trim().length === 0) return { ok: true, headers: undefined };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Headers must be valid JSON.",
    };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((value) => typeof value === "string")
  ) {
    return { ok: false, error: "Headers must be a JSON object with string values." };
  }
  return { ok: true, headers: parsed as Record<string, string> };
}

interface AcpSessionManagementProps {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider;
  readonly projects: ReadonlyArray<AcpSessionProject>;
  readonly readOnly: boolean;
}

export function AcpSessionManagementSection(props: AcpSessionManagementProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | null>(null);
  const projectId =
    props.projects.find((project) => project.id === selectedProjectId)?.id ??
    props.projects[0]?.id ??
    null;
  if (selectedProjectId !== projectId) setSelectedProjectId(projectId);

  return (
    <InstanceSessionManagement
      key={JSON.stringify([props.environmentId, props.instanceId])}
      {...props}
      projectId={projectId}
      onProjectChange={setSelectedProjectId}
    />
  );
}

function InstanceSessionManagement(
  props: AcpSessionManagementProps & {
    readonly projectId: ProjectId | null;
    readonly onProjectChange: (projectId: ProjectId) => void;
  },
) {
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const canRead = useEnvironmentScope(props.environmentId, AuthOrchestrationReadScope);
  const { projectId } = props;
  const projectGeneration = useRef(0);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Late continuations must not act on a replaced project scope.
  useLayoutEffect(() => {
    return () => {
      projectGeneration.current += 1;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Retiring a project invalidates its pending operations even when the instance stays mounted.
  }, [projectId]);
  const [sessions, setSessions] = useState<ReadonlyArray<AcpRegistrySession>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [operations, setOperations] = useState<ReadonlyArray<AcpOperation>>([]);
  const [providers, setProviders] = useState<ReadonlyArray<AcpRegistryConfigurableProvider>>([]);
  const [providerDrafts, setProviderDrafts] = useState<
    Readonly<Record<string, { apiType: string; baseUrl: string; headers: string }>>
  >({});
  const [previousProjectId, setPreviousProjectId] = useState(projectId);
  if (previousProjectId !== projectId) {
    setPreviousProjectId(projectId);
    setSessions([]);
    setNextCursor(null);
    setOperations((current) => current.filter((operation) => operation.type === "loggingOut"));
    setProviders([]);
    setProviderDrafts({});
  }
  const listSessions = useAtomCommand(serverEnvironment.listAcpRegistrySessions, {
    reportFailure: false,
  });
  const importSession = useAtomCommand(serverEnvironment.importAcpRegistrySession, {
    reportFailure: false,
  });
  const deleteSession = useAtomCommand(serverEnvironment.deleteAcpRegistrySession, {
    reportFailure: false,
  });
  const listProviders = useAtomCommand(serverEnvironment.listAcpRegistryProviders, {
    reportFailure: false,
  });
  const setProvider = useAtomCommand(serverEnvironment.setAcpRegistryProvider, {
    reportFailure: false,
  });
  const disableProvider = useAtomCommand(serverEnvironment.disableAcpRegistryProvider, {
    reportFailure: false,
  });
  const logout = useAtomCommand(serverEnvironment.logoutAcpRegistry, { reportFailure: false });
  const canList = props.provider.nativeSessions?.canList === true;
  const canImport =
    props.provider.nativeSessions?.canLoad === true ||
    props.provider.nativeSessions?.canResume === true;
  const canLogout =
    props.provider.auth.canLogout === true && !props.provider.setup?.canAuthenticate;
  const canDelete = props.provider.nativeSessions?.canDelete === true;
  const canConfigureProviders = props.provider.configurableProviders === true;
  const canStart = (operation: AcpOperation) => canStartAcpOperation(operations, operation);
  const running = <Type extends AcpOperation["type"]>(type: Type) =>
    operations.find(
      (operation): operation is Extract<AcpOperation, { readonly type: Type }> =>
        operation.type === type,
    );
  const savingProvider = running("savingProvider");
  const projectOperationPending = operations.some((operation) => operation.type !== "loggingOut");

  if (!canList && !canLogout && !canConfigureProviders) return null;

  const track = async <A,>(operation: AcpOperation, pending: Promise<A>) => {
    setOperations((current) => [...current, operation]);
    const result = await pending;
    setOperations((current) => current.filter((candidate) => candidate !== operation));
    return result;
  };

  const loadSessions = async (cursor?: string) => {
    const generation = projectGeneration.current;
    const operation = { type: "listing" } as const;
    if (projectId === null || !canStart(operation)) return;
    const result = await track(
      operation,
      listSessions({
        environmentId: props.environmentId,
        input: {
          instanceId: props.instanceId,
          projectId,
          ...(cursor === undefined ? {} : { cursor }),
        },
      }),
    );
    if (generation !== projectGeneration.current) return;
    if (result._tag === "Success") {
      setSessions((current) =>
        cursor === undefined ? result.value.sessions : [...current, ...result.value.sessions],
      );
      setNextCursor(result.value.nextCursor);
      return;
    }
    reportFailure("Could not list ACP sessions", result);
  };

  const importNativeSession = async (session: AcpRegistrySession) => {
    const generation = projectGeneration.current;
    const operation = { type: "importing", sessionId: session.sessionId } as const;
    if (
      !readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope) ||
      projectId === null ||
      !canStart(operation)
    )
      return;
    const result = await track(
      operation,
      importSession({
        environmentId: props.environmentId,
        input: {
          instanceId: props.instanceId,
          projectId,
          sessionId: session.sessionId,
          title: session.title,
          updatedAt: session.updatedAt,
        },
      }),
    );
    if (generation !== projectGeneration.current) return;
    if (result._tag === "Success") {
      setSessions((current) =>
        current.map((candidate) =>
          candidate.sessionId === session.sessionId
            ? { ...candidate, importedThreadId: result.value.threadId }
            : candidate,
        ),
      );
      toastManager.add({
        type: "success",
        title: result.value.imported ? "ACP session imported" : "ACP session already imported",
      });
      return;
    }
    reportFailure("Could not import ACP session", result);
  };

  const deleteNativeSession = async (session: AcpRegistrySession) => {
    const generation = projectGeneration.current;
    const operation = { type: "deleting", sessionId: session.sessionId } as const;
    if (projectId === null || !canStart(operation) || session.importedThreadId !== null) return;
    if (!readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope)) return;
    const result = await track(
      operation,
      deleteSession({
        environmentId: props.environmentId,
        input: { instanceId: props.instanceId, projectId, sessionId: session.sessionId },
      }),
    );
    if (generation !== projectGeneration.current) return;
    if (result._tag === "Success") {
      setSessions((current) =>
        current.filter((candidate) => candidate.sessionId !== session.sessionId),
      );
      toastManager.add({ type: "success", title: "ACP session deleted" });
      return;
    }
    reportFailure("Could not delete ACP session", result);
  };

  const loadProviders = async (resetProviderId?: string) => {
    const generation = projectGeneration.current;
    const operation = { type: "loadingProviders" } as const;
    if (projectId === null || !canStart(operation)) return;
    const result = await track(
      operation,
      listProviders({
        environmentId: props.environmentId,
        input: { instanceId: props.instanceId, projectId },
      }),
    );
    if (generation !== projectGeneration.current) return;
    if (result._tag === "Success") {
      setProviders(result.value.providers);
      setProviderDrafts((current) =>
        Object.fromEntries(
          result.value.providers.map((provider) => [
            provider.providerId,
            (resetProviderId !== undefined && provider.providerId !== resetProviderId
              ? current[provider.providerId]
              : undefined) ?? {
              apiType: provider.current?.apiType ?? provider.supported[0] ?? "",
              baseUrl: provider.current?.baseUrl ?? "",
              headers: "",
            },
          ]),
        ),
      );
      return;
    }
    reportFailure("Could not list ACP providers", result);
  };

  const saveProvider = async (provider: AcpRegistryConfigurableProvider) => {
    const generation = projectGeneration.current;
    const operation = { type: "savingProvider", providerId: provider.providerId } as const;
    if (
      !readEnvironmentScope(props.environmentId, AuthProvidersManageScope) ||
      projectId === null ||
      !canStart(operation)
    )
      return;
    const draft = providerDrafts[provider.providerId];
    if (draft === undefined || draft.apiType.length === 0 || draft.baseUrl.length === 0) return;
    const parsedHeaders = parseProviderHeaders(draft.headers);
    if (!parsedHeaders.ok) {
      toastManager.add({
        type: "error",
        title: "Invalid provider headers",
        description: parsedHeaders.error,
      });
      return;
    }
    const headers = parsedHeaders.headers;
    const result = await track(
      operation,
      setProvider({
        environmentId: props.environmentId,
        input: {
          instanceId: props.instanceId,
          projectId,
          providerId: provider.providerId,
          apiType: draft.apiType,
          baseUrl: draft.baseUrl,
          ...(headers === undefined ? {} : { headers }),
        },
      }),
    );
    if (generation !== projectGeneration.current) return;
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: "ACP provider configured" });
      await loadProviders(provider.providerId);
      return;
    }
    reportFailure("Could not configure ACP provider", result);
  };

  const disableConfiguredProvider = async (provider: AcpRegistryConfigurableProvider) => {
    const generation = projectGeneration.current;
    const operation = { type: "savingProvider", providerId: provider.providerId } as const;
    if (projectId === null || !canStart(operation) || provider.required) return;
    if (!readEnvironmentScope(props.environmentId, AuthProvidersManageScope)) return;
    const result = await track(
      operation,
      disableProvider({
        environmentId: props.environmentId,
        input: { instanceId: props.instanceId, projectId, providerId: provider.providerId },
      }),
    );
    if (generation !== projectGeneration.current) return;
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: "ACP provider disabled" });
      await loadProviders(provider.providerId);
      return;
    }
    reportFailure("Could not disable ACP provider", result);
  };

  const logoutProvider = async () => {
    const operation = { type: "loggingOut" } as const;
    if (
      !canStart(operation) ||
      !readEnvironmentScope(props.environmentId, AuthProvidersManageScope)
    )
      return;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Log out of ${props.provider.displayName ?? "this agent"}? This stops running threads that share this sign-in, including other instances of the same agent. Thread history is kept.`,
    );
    if (!confirmed || !readEnvironmentScope(props.environmentId, AuthProvidersManageScope)) return;
    const result = await track(
      operation,
      logout({
        environmentId: props.environmentId,
        input: { instanceId: props.instanceId },
      }),
    );
    if (result._tag === "Success") {
      setSessions([]);
      setNextCursor(null);
      toastManager.add({ type: "success", title: "Logged out of ACP agent" });
      return;
    }
    reportFailure("Could not log out of ACP agent", result);
  };

  return (
    <div className="grid gap-3">
      <SettingsRow
        title="Native sessions"
        description="Resume agent-owned conversations as Supaterm threads."
        status={
          canList && props.projects.length === 0
            ? "Add a project before importing sessions."
            : undefined
        }
        control={
          <div className="flex flex-wrap items-center gap-2">
            {canLogout ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={props.readOnly || !canStart({ type: "loggingOut" })}
                onClick={() => void logoutProvider()}
              >
                {running("loggingOut") ? "Logging out" : "Log out"}
              </Button>
            ) : null}
            {canList && props.projects.length > 0 ? (
              <>
                <Select
                  value={projectId ?? ""}
                  disabled={!canRead || projectOperationPending}
                  onValueChange={(value) => {
                    if (value === null) return;
                    props.onProjectChange(value as ProjectId);
                  }}
                >
                  <SelectTrigger aria-label="Project for ACP sessions" className="w-40" size="sm">
                    <SelectValue>
                      {props.projects.find((project) => project.id === projectId)?.title}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {props.projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canRead || !canStart({ type: "listing" }) || projectId === null}
                  onClick={() => void loadSessions()}
                >
                  {running("listing")
                    ? "Loading"
                    : sessions.length === 0
                      ? "List sessions"
                      : "Refresh"}
                </Button>
              </>
            ) : null}
          </div>
        }
      >
        {canList && (sessions.length > 0 || nextCursor !== null) ? (
          <>
            {sessions.length > 0 ? (
              <div className="divide-y divide-border/60 border-y border-border/60">
                {sessions.map((session) => (
                  <div
                    key={session.sessionId}
                    className="flex min-w-0 items-center justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs text-foreground">
                        {session.title ?? session.sessionId}
                      </p>
                      <code className="block truncate text-3xs text-muted-foreground">
                        {session.sessionId}
                      </code>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost-muted"
                        disabled={
                          !canOperate ||
                          !canImport ||
                          session.importedThreadId !== null ||
                          !canStart({ type: "importing", sessionId: session.sessionId })
                        }
                        onClick={() => void importNativeSession(session)}
                      >
                        {session.importedThreadId !== null
                          ? "Imported"
                          : running("importing")?.sessionId === session.sessionId
                            ? "Importing"
                            : "Import"}
                      </Button>
                      {canDelete ? (
                        <InlineConfirmButton
                          size="xs"
                          variant="ghost-muted"
                          disabled={
                            !canOperate ||
                            session.importedThreadId !== null ||
                            !canStart({ type: "deleting", sessionId: session.sessionId })
                          }
                          label={
                            running("deleting")?.sessionId === session.sessionId
                              ? "Deleting"
                              : "Delete"
                          }
                          confirmLabel="Confirm delete"
                          tooltip="Delete this session from the agent"
                          confirmTooltip="Click again to permanently delete this session. The agent can't restore it."
                          onConfirm={() => void deleteNativeSession(session)}
                        />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {nextCursor !== null ? (
              <Button
                type="button"
                size="xs"
                variant="ghost-muted"
                className="w-fit"
                disabled={!canRead || !canStart({ type: "listing" })}
                onClick={() => void loadSessions(nextCursor)}
              >
                {running("listing") ? "Loading" : "Load more"}
              </Button>
            ) : null}
          </>
        ) : null}
      </SettingsRow>

      {canConfigureProviders ? (
        <div className="grid gap-3 border-t border-border/60 px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-foreground">Agent providers</p>
              <p className="text-xs text-muted-foreground">
                Configure non-secret routing. Headers are write-only.
              </p>
            </div>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!canRead || !canStart({ type: "loadingProviders" }) || projectId === null}
              onClick={() => void loadProviders()}
            >
              {running("loadingProviders")
                ? "Loading"
                : providers.length === 0
                  ? "List providers"
                  : "Refresh"}
            </Button>
          </div>

          {!canList && props.projects.length > 1 ? (
            <Select
              value={projectId ?? ""}
              disabled={!canRead || projectOperationPending}
              onValueChange={(value) => {
                if (value === null) return;
                props.onProjectChange(value as ProjectId);
              }}
            >
              <SelectTrigger aria-label="Project for ACP providers" className="min-w-48" size="xs">
                <SelectValue>
                  {props.projects.find((project) => project.id === projectId)?.title}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {props.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}

          {providers.length > 0 ? (
            <div className="divide-y divide-border/60 border-y border-border/60">
              {providers.map((provider) => {
                const draft = providerDrafts[provider.providerId] ?? {
                  apiType: provider.current?.apiType ?? provider.supported[0] ?? "",
                  baseUrl: provider.current?.baseUrl ?? "",
                  headers: "",
                };
                const updateDraft = (update: Partial<typeof draft>) =>
                  setProviderDrafts((current) => ({
                    ...current,
                    [provider.providerId]: { ...draft, ...update },
                  }));
                const canSave = canStart({
                  type: "savingProvider",
                  providerId: provider.providerId,
                });
                return (
                  <div key={provider.providerId} className="grid gap-2 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">
                          {provider.providerId}
                        </p>
                        <p className="text-3xs text-muted-foreground">
                          {provider.current === null ? "Disabled" : "Configured"}
                          {provider.required ? " · Required" : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={
                            props.readOnly ||
                            !canSave ||
                            draft.apiType.length === 0 ||
                            draft.baseUrl.length === 0
                          }
                          onClick={() => void saveProvider(provider)}
                        >
                          {savingProvider?.providerId === provider.providerId ? "Saving" : "Save"}
                        </Button>
                        {!provider.required && provider.current !== null ? (
                          <InlineConfirmButton
                            size="xs"
                            variant="ghost-muted"
                            disabled={props.readOnly || !canSave}
                            label="Disable"
                            confirmLabel="Confirm disable"
                            tooltip={`Disable ${provider.providerId}`}
                            confirmTooltip={`Click again to disable ${provider.providerId}. Turning it back on means entering its base URL and headers again.`}
                            onConfirm={() => void disableConfiguredProvider(provider)}
                          />
                        ) : null}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
                      <Select
                        value={draft.apiType}
                        disabled={props.readOnly || savingProvider !== undefined}
                        onValueChange={(value) => {
                          if (value !== null) updateDraft({ apiType: value });
                        }}
                      >
                        <SelectTrigger aria-label={`${provider.providerId} protocol`} size="sm">
                          <SelectValue>{draft.apiType}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {provider.supported.map((protocol) => (
                            <SelectItem key={protocol} value={protocol}>
                              {protocol}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      <Input
                        size="sm"
                        type="url"
                        aria-label={`${provider.providerId} base URL`}
                        placeholder="https://api.example.com"
                        value={draft.baseUrl}
                        disabled={props.readOnly || savingProvider !== undefined}
                        onValueChange={(value) => updateDraft({ baseUrl: value })}
                      />
                    </div>
                    <Input
                      size="sm"
                      type="password"
                      aria-label={`${provider.providerId} write-only headers JSON`}
                      placeholder='Write-only headers JSON, e.g. {"Authorization":"Bearer …"}'
                      value={draft.headers}
                      disabled={props.readOnly || savingProvider !== undefined}
                      onValueChange={(value) => updateDraft({ headers: value })}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
