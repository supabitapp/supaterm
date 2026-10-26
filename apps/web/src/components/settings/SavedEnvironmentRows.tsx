import { usePreparedConnection } from "../../state/session";
import { SessionPermissions } from "./SessionPermissions";
import {
  ChevronRightIcon,
  ChevronsLeftRightEllipsisIcon,
  EllipsisIcon,
  PencilIcon,
  RouteIcon,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { type EnvironmentId, resolveEnvironmentMachineKind } from "@supaterm/contracts";
import {
  connectionRoutes,
  hasSavedBearerRoute,
  connectionStatusText,
  environmentMcpUrl,
} from "@supaterm/client-runtime/connection";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { EnvironmentIconMenu } from "./EnvironmentIconPicker";
import { RenameEnvironmentDialog } from "./RenameEnvironmentDialog";
import { EnvironmentRoutesList } from "./EnvironmentRoutesList";
import {
  ConnectionDiagnosisPanel,
  ConnectionDiagnosisSummary,
  useConnectionDiagnosis,
} from "./ConnectionDiagnosisDetails";
import { EnvironmentRow, environmentTransportLabel } from "./EnvironmentRow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button, InlineButton } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import {
  resolveServerConfigVersionMismatch,
  resolveServerSelfUpdateCapability,
  supportsDesktopAppUpdate,
} from "~/versionSkew";
import { environmentCatalog } from "~/connection/catalog";
import { type EnvironmentPresentation } from "~/state/environments";
import { APP_VERSION } from "~/branding";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "~/state/server";
import {
  OutdatedServerUpdateAction,
  ServerUpdateAction,
  ServerUpdateProgress,
} from "../ServerUpdateAction";

type SavedBackendListRowProps = {
  environment: EnvironmentPresentation;
  removingEnvironmentId: EnvironmentId | null;
  onSetEnabled: (environmentId: EnvironmentId, enabled: boolean) => void;
  onRemove: (environment: EnvironmentPresentation) => void;
  onAddRoute: (environment: EnvironmentPresentation) => void;
};

function savedBackendStatus(environment: EnvironmentPresentation): {
  readonly text: string;
  readonly tone: "muted" | "warning" | "error";
} {
  if (!environment.entry.enabled && environment.connection.phase !== "unsupported")
    return { text: "Off", tone: "muted" };
  const { connection } = environment;
  switch (connection.phase) {
    case "connected":
      return { text: "Connected", tone: "muted" };
    case "connecting":
      return { text: "Connecting", tone: "warning" };
    case "reconnecting":
      return { text: "Reconnecting", tone: "warning" };
    case "unsupported":
      return { text: "Client not supported", tone: "muted" };
    case "error":
      return { text: "Connection failed", tone: "error" };
    case "offline":
      return { text: "Offline", tone: "muted" };
    case "available":
      return { text: "Not connected", tone: "muted" };
  }
}

export function SavedBackendListRow({
  environment,
  removingEnvironmentId,
  onSetEnabled,
  onRemove,
  onAddRoute,
}: SavedBackendListRowProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const environmentId = environment.environmentId;
  const unsupported = environment.connection.phase === "unsupported";
  const blocked = unsupported && !hasSavedBearerRoute(environment.entry);
  const enabled = environment.entry.enabled && !unsupported;
  const isConnected = environment.connection.phase === "connected";
  const isRemoving = removingEnvironmentId === environmentId;
  const errorTraceId = environment.connection.traceId;
  const { copyToClipboard: copyTraceIdToClipboard } = useCopyToClipboard<{ traceId: string }>({
    target: "trace ID",
    onCopy: ({ traceId }) => {
      toastManager.add({
        type: "success",
        title: "Trace ID copied",
        description: traceId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not copy trace ID",
          description: error.message,
        }),
      );
    },
  });
  const copyTraceId = (traceId: string) => {
    copyTraceIdToClipboard(traceId, { traceId });
  };
  const { copyToClipboard: copyMcpUrl } = useCopyToClipboard<{ url: string }>({
    target: "MCP URL",
    onCopy: ({ url }) => {
      toastManager.add({
        type: "success",
        title: "MCP URL copied",
        description: `Add it to an agent, e.g. claude mcp add --transport http supaterm ${url}`,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not copy MCP URL",
          description: error.message,
        }),
      );
    },
  });
  const versionMismatch = resolveServerConfigVersionMismatch(environment.serverConfig);
  const serverUpdateState = useAtomValue(serverEnvironment.updateStateAtom(environmentId));
  const resumingServerUpdate =
    serverUpdateState.status === "running" && serverUpdateState.stage === "resuming";
  const status = savedBackendStatus(environment);
  const serverVersion = environment.serverConfig?.environment.serverVersion ?? null;
  const machineKind = resolveEnvironmentMachineKind(environment.serverConfig);
  const retryNow = useAtomCommand(environmentCatalog.retryNow);
  const {
    diagnosis: currentDiagnosis,
    state: connectionState,
    relayOnly,
  } = useConnectionDiagnosis(environment);
  const diagnosis = resumingServerUpdate ? null : currentDiagnosis;
  const prepared = usePreparedConnection(environmentId);
  const connectedTarget = isConnected && prepared._tag === "Some" ? prepared.value.target : null;
  const mcpUrl = environmentMcpUrl({ entry: environment.entry, connectedTarget });
  const routeCount = connectionRoutes(environment.entry).length;
  const subtitleText = [
    environmentTransportLabel(environment),
    // The headline below names the failure in full.
    diagnosis ? null : resumingServerUpdate ? "Restarting" : status.text,
    enabled && versionMismatch ? serverVersion : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");

  const showUpdateAction =
    enabled &&
    isConnected &&
    versionMismatch !== null &&
    (serverUpdateState.status === "idle" || serverUpdateState.status === "failed");

  const statusTooltip = `${
    unsupported
      ? (environment.connection.error ?? connectionStatusText(environment.connection))
      : enabled
        ? connectionStatusText(environment.connection)
        : "Switched off"
  }${
    versionMismatch
      ? `\nUpdate available: ${versionMismatch.serverVersion} → ${versionMismatch.clientVersion}`
      : ""
  }`;

  return (
    <EnvironmentRow
      kind={machineKind}
      label={environment.label}
      dimmed={!enabled}
      status={
        <Popover>
          <PopoverTrigger render={<InlineButton tone="muted" />}>
            <span
              className={cn(
                "text-xs font-normal",
                !resumingServerUpdate && status.tone === "error" && "text-destructive",
                !resumingServerUpdate && status.tone === "warning" && "text-warning-foreground",
              )}
            >
              {resumingServerUpdate ? "Restarting" : status.text}
            </span>
          </PopoverTrigger>
          <PopoverPopup side="bottom" align="start">
            <p className="max-w-80 text-xs wrap-anywhere whitespace-pre-wrap">{statusTooltip}</p>
          </PopoverPopup>
        </Popover>
      }
      subtitle={
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <Tooltip>
            {/* The status can change while the tooltip is open, and base-ui only
                re-measures the popup when the trigger's payload changes. */}
            <TooltipTrigger
              payload={statusTooltip}
              render={
                <span
                  className={cn(
                    "min-w-0 truncate",
                    enabled &&
                      status.tone === "error" &&
                      !resumingServerUpdate &&
                      !diagnosis &&
                      "text-destructive",
                  )}
                />
              }
            >
              {subtitleText}
            </TooltipTrigger>
            <TooltipPopup side="top">{statusTooltip}</TooltipPopup>
          </Tooltip>
          {enabled && versionMismatch ? (
            <span className="max-w-full truncate font-mono text-2xs">{serverVersion}</span>
          ) : null}
        </span>
      }
      below={
        <>
          {diagnosis ? (
            <ConnectionDiagnosisSummary
              diagnosis={diagnosis}
              retryAt={connectionState.phase === "backoff" ? connectionState.retryAt : null}
              attempt={connectionState.attempt}
              expanded={diagnosisOpen}
              onToggle={() => setDiagnosisOpen((open) => !open)}
            />
          ) : null}
          {serverUpdateState.status !== "idle" ? (
            <div className="mt-1 max-w-md">
              <ServerUpdateProgress state={serverUpdateState} />
            </div>
          ) : null}
        </>
      }
      detail={
        <>
          {renameOpen && (
            <RenameEnvironmentDialog
              environment={environment}
              onClose={() => setRenameOpen(false)}
            />
          )}
          {diagnosis && diagnosisOpen ? (
            <ConnectionDiagnosisPanel
              hostLabel={environment.label}
              diagnosis={diagnosis}
              onRetry={() => void retryNow(environmentId)}
              onAddRoute={relayOnly ? () => onAddRoute(environment) : null}
            />
          ) : null}
          {routesOpen && (
            <EnvironmentRoutesList
              environment={environment}
              onAddRoute={() => onAddRoute(environment)}
            />
          )}
          {permissionsOpen && (
            <div
              id={`remote-permissions-${environmentId}`}
              className="mt-2 border-t border-border/50"
            >
              <SessionPermissions
                environmentId={environmentId}
                connected={isConnected}
                routeContext
              />
            </div>
          )}
        </>
      }
    >
      <div className="flex flex-col items-end gap-4 sm:flex-row sm:items-center sm:gap-1">
        {unsupported &&
        environment.entry.serverUpdateRequired === true &&
        serverUpdateState.status !== "running" ? (
          <OutdatedServerUpdateAction
            environmentId={environmentId}
            serverLabel={`${environment.label} server`}
            fromVersion={serverVersion ?? undefined}
            targetVersion={APP_VERSION}
            label={serverUpdateState.status === "failed" ? "Retry update" : "Update"}
          />
        ) : null}
        {showUpdateAction ? (
          <ServerUpdateAction
            environmentId={environmentId}
            serverLabel={`${environment.label} server`}
            selfUpdate={resolveServerSelfUpdateCapability(environment.serverConfig)}
            installation={environment.serverConfig?.environment.capabilities.serverInstallation}
            desktopAppUpdate={supportsDesktopAppUpdate(environment.serverConfig)}
            targetVersion={versionMismatch.clientVersion}
            label={serverUpdateState.status === "failed" ? "Retry update" : "Update"}
            appearance="icon"
          />
        ) : null}
        <div className="flex items-center gap-1">
          <Button
            size="micro"
            variant="ghost-muted"
            aria-expanded={routesOpen}
            onClick={() => setRoutesOpen((open) => !open)}
          >
            {routeCount === 1 ? "Routes" : `${routeCount} routes`}
            <ChevronRightIcon aria-hidden className={cn("size-3", routesOpen && "rotate-90")} />
          </Button>
          <Button
            size="micro"
            variant="ghost-muted"
            aria-expanded={permissionsOpen}
            aria-controls={`remote-permissions-${environmentId}`}
            onClick={() => setPermissionsOpen((open) => !open)}
          >
            Permissions
            <ChevronRightIcon
              aria-hidden
              className={cn("size-3", permissionsOpen && "rotate-90")}
            />
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Switch
                  size="sm"
                  checked={enabled}
                  disabled={isRemoving || blocked}
                  aria-label={`${enabled ? "Switch off" : "Switch on"} ${environment.label}`}
                  onCheckedChange={(checked) => onSetEnabled(environmentId, checked)}
                />
              }
            />
            <TooltipPopup side="top">
              {blocked ? "Client not supported" : enabled ? "Switch off" : "Switch on"}
            </TooltipPopup>
          </Tooltip>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="icon-xs"
                  disabled={isRemoving}
                  aria-label={`More actions for ${environment.label}`}
                />
              }
            >
              <EllipsisIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => setRenameOpen(true)}>
                <PencilIcon />
                Rename…
              </MenuItem>
              <EnvironmentIconMenu
                environmentId={environmentId}
                serverConfig={environment.serverConfig}
              />
              <MenuItem onClick={() => setRoutesOpen((open) => !open)}>
                <RouteIcon />
                {routesOpen ? "Hide routes" : "Routes"}
              </MenuItem>
              {mcpUrl ? (
                <MenuItem onClick={() => copyMcpUrl(mcpUrl, { url: mcpUrl })}>
                  Copy MCP URL
                </MenuItem>
              ) : null}
              {errorTraceId ? (
                <MenuItem onClick={() => copyTraceId(errorTraceId)}>Copy trace ID</MenuItem>
              ) : null}
              <MenuSeparator />
              <MenuItem variant="destructive" onClick={() => onRemove(environment)}>
                {isRemoving ? "Removing…" : "Remove from this device…"}
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
    </EnvironmentRow>
  );
}

export function EmptyRemoteEnvironments() {
  return (
    <Empty className="min-h-52">
      <EmptyMedia variant="icon">
        <ChevronsLeftRightEllipsisIcon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>No saved remote environments</EmptyTitle>
        <EmptyDescription>Click “Add environment” to pair another environment.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
