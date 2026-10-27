import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import {
  type ConnectionRoute,
  connectionRouteAddress,
  connectionRouteId,
  connectionRouteKind,
  connectionRouteLabel,
  connectionRoutes,
  isLearned,
  usableRoutes,
} from "@supaterm/client-runtime/connection";
import { GripVerticalIcon, LockIcon, PlusIcon, RefreshCwIcon, XIcon } from "@supaterm/icons";
import { useContext, useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { environmentCatalog } from "~/connection/catalog";
import { cn } from "~/lib/utils";
import type { EnvironmentPresentation } from "~/state/environments";
import { environmentSession, usePreparedConnection } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The ways this client reaches one saved machine, preferred first. Drag to
 * reorder; the first reachable direct route is used. Shown under the machine's row.
 */
export function EnvironmentRoutesList({
  environment,
  onAddRoute,
}: {
  readonly environment: EnvironmentPresentation;
  readonly onAddRoute: () => void;
}) {
  const registry = useContext(RegistryContext);
  const saved = connectionRoutes(environment.entry);
  const savedIds = saved.map((route) => connectionRouteId(route.target));
  const [pending, setPending] = useState<ReadonlyArray<string> | null>(null);
  const order: Array<string> =
    pending !== null &&
    pending.length === savedIds.length &&
    pending.some((id, index) => id !== savedIds[index])
      ? [...pending]
      : savedIds;
  const byId = new Map(saved.map((route) => [connectionRouteId(route.target), route]));
  const routes = order.flatMap((id) => byId.get(id) ?? []);
  const usable = new Set(
    usableRoutes(environment.entry).map((route) => connectionRouteId(route.target)),
  );

  const prepared = usePreparedConnection(environment.environmentId);
  const activeRouteId =
    prepared._tag === "Some" && environment.connection.phase === "connected"
      ? connectionRouteId(prepared.value.target)
      : null;
  const reorder = useAtomCommand(environmentCatalog.reorderRoutes, "Reorder routes");
  const removeRoute = useAtomCommand(environmentCatalog.removeRoute, "Remove route");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const confirmRemove = async (route: ConnectionRoute) => {
    const address = connectionRouteAddress(route);
    const confirmed = await requestConfirmDialog(
      `Remove ${connectionRouteLabel(route)} route?${address === null ? "" : `\n${address}`}`,
      { variant: "destructive" },
    );
    if (confirmed !== true) return;
    await removeRoute({
      environmentId: environment.environmentId,
      routeId: connectionRouteId(route.target),
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over === null || event.active.id === event.over.id) return;
    const next = arrayMove(
      order,
      order.indexOf(String(event.active.id)),
      order.indexOf(String(event.over.id)),
    );
    setPending(next);
    void reorder({ environmentId: environment.environmentId, routeIds: next }).then((result) => {
      if (result._tag === "Failure") setPending(null);
    });
  };

  return (
    <div className="mt-3 border-t border-border/60 pt-1">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol aria-label={`Routes to ${environment.label}, preferred first`}>
            {routes.map((route, index) => {
              const unused = !usable.has(connectionRouteId(route.target));
              return (
                <SortableRouteRow
                  key={connectionRouteId(route.target)}
                  route={route}
                  position={index + 1}
                  inUse={connectionRouteId(route.target) === activeRouteId}
                  unused={unused}
                  // Learned routes are refreshed from the server and are not
                  // removed manually unless a connect skips them; paired
                  // routes can be removed individually.
                  removable={routes.length > 1 && (!isLearned(route) || unused)}
                  onRemove={() => void confirmRemove(route)}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
      <div className="flex items-center justify-between pt-1">
        <Button size="xs" variant="ghost-muted" onClick={onAddRoute}>
          <PlusIcon className="size-3" />
          Add route
        </Button>
        <Button
          size="xs"
          variant="ghost-muted"
          aria-label="Refresh route latency"
          onClick={() => {
            for (const route of routes) {
              registry.refresh(environmentSession.routeLatencyAtoms(route).resultAtom);
            }
          }}
        >
          <RefreshCwIcon className="size-3" />
          Refresh
        </Button>
      </div>
    </div>
  );
}

const NO_LATENCY = Atom.make("");

function SortableRouteRow({
  route,
  position,
  inUse,
  unused,
  removable,
  onRemove,
}: {
  readonly route: ConnectionRoute;
  readonly position: number;
  readonly inUse: boolean;
  readonly unused: boolean;
  readonly removable: boolean;
  readonly onRemove: () => void;
}) {
  const id = connectionRouteId(route.target);
  const label = connectionRouteLabel(route);
  const address = connectionRouteAddress(route);
  // A route a connect skips has no speed worth measuring.
  const latency = useAtomValue(
    unused ? NO_LATENCY : environmentSession.routeLatencyAtoms(route).labelAtom,
  );
  const transport = useAtomValue(environmentSession.relayRouteTransportAtom(route));
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/route grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-1 py-2",
        isDragging && "relative z-10 rounded-md bg-background shadow-md",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${label}, position ${position}`}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
      >
        <GripVerticalIcon aria-hidden className="size-3.5" />
      </button>
      <div className="grid min-w-0 gap-y-0.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-baseline sm:gap-x-3">
        <p
          className={cn(
            "flex flex-wrap items-center gap-x-1.5 text-xs font-medium",
            unused ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {connectionRouteKind(route) === "relay" ? (
            <LockIcon aria-hidden className="size-3 shrink-0" />
          ) : null}
          <Tooltip>
            <TooltipTrigger render={<span className="min-w-0 truncate" />}>{label}</TooltipTrigger>
            <TooltipPopup side="top">{label}</TooltipPopup>
          </Tooltip>
          {inUse ? (
            <span className="text-2xs font-normal text-success-foreground">In use</span>
          ) : null}
          {transport === "direct" ? (
            <Tooltip>
              <TooltipTrigger
                render={<span className="text-2xs font-normal text-muted-foreground" />}
              >
                Direct
              </TooltipTrigger>
              <TooltipPopup side="top">
                Encrypted connection straight to the host, skipping the relay server
              </TooltipPopup>
            </Tooltip>
          ) : null}
          {unused ? <span className="text-2xs font-normal">Not used</span> : null}
        </p>
        {address !== null ? (
          <p className="flex min-w-0 items-baseline gap-2 text-2xs text-muted-foreground">
            <Tooltip>
              <TooltipTrigger render={<span className="truncate font-mono" />}>
                {address}
              </TooltipTrigger>
              <TooltipPopup side="top">{address}</TooltipPopup>
            </Tooltip>
            {isLearned(route) ? <span className="shrink-0">Discovered</span> : null}
          </p>
        ) : null}
      </div>
      <span
        aria-label={unused ? undefined : `${label} route latency: ${latency}`}
        className="w-20 text-right text-2xs tabular-nums text-muted-foreground"
      >
        {latency}
      </span>
      <div className="flex size-7 items-center justify-end sm:size-6">
        {removable ? (
          <div className="pointer-events-none opacity-0 group-focus-within/route:pointer-events-auto group-focus-within/route:opacity-100 group-hover/route:pointer-events-auto group-hover/route:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={`Remove ${label} route`}
                    onClick={onRemove}
                  />
                }
              >
                <XIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">Remove route</TooltipPopup>
            </Tooltip>
          </div>
        ) : null}
      </div>
    </li>
  );
}
