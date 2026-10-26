import { type TimelineRow, TimelineRowCtx } from "./timelineRowContext";
import { v2EventPresentation, subagentGroupTiming } from "./TimelineV2EventRow.logic";
import { WorkLogBlock } from "./WorkLog";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import { environmentThreadDetails } from "../../state/threads";
import {
  subagentGroupSummary,
  summarizeSubagentStatuses,
} from "@supaterm/client-runtime/state/subagent-display";
import { use, useState, memo } from "react";
import ChatMarkdown from "../ChatMarkdown";
import { cn } from "~/lib/utils";
import { V2ItemInspector } from "./V2ItemInspector";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "../ui/collapsible";
import { DisclosureChevron } from "../ui/disclosure-chevron";
import {
  isV2LifecycleItem,
  V2LifecycleRow,
  EnvironmentSubagentAvatar,
  SubagentElapsed,
} from "./V2LifecycleRow";

export function V2EventTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "event" }> }) {
  const ctx = use(TimelineRowCtx);
  const { item, visibility, sourceThreadId } = row.projectedItem;
  if (item.type === "subagent" && (row.subagents?.length ?? 1) > 1) {
    return <V2SubagentGroup key={row.id} row={row} />;
  }
  if (isV2LifecycleItem(item)) {
    return (
      <V2LifecycleRow
        environmentId={ctx.activeThreadEnvironmentId}
        item={item}
        resourceSummary={row.resourceSummary}
        createdAt={row.createdAt}
        timestampFormat={ctx.timestampFormat}
        runs={ctx.runs}
        onOpenThread={ctx.onOpenThread}
      />
    );
  }
  const presentation = v2EventPresentation(item);
  const Icon = presentation.icon;
  if (item.type === "error") {
    return <V2ErrorEventRow key={row.id} row={row} presentation={presentation} />;
  }
  return (
    <section
      className={cn(
        "rounded-lg border px-3 py-2",
        presentation.tone === "warning" && "border-warning/25 bg-warning/5",
        presentation.tone === "danger" && "border-destructive/25 bg-destructive/5",
        presentation.tone === "success" && "border-success/20 bg-success/5",
        presentation.tone === "muted" && "border-border/60 bg-card/30",
      )}
      data-v2-item-type={item.type}
      data-v2-item-visibility={visibility}
    >
      <div className="flex items-start gap-2.5">
        <Icon
          className={cn(
            "mt-0.5 size-3.5 shrink-0",
            presentation.tone === "warning" && "text-warning",
            presentation.tone === "danger" && "text-destructive",
            presentation.tone === "success" && "text-success",
            presentation.tone === "muted" && "text-muted-foreground",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-foreground/90">{presentation.label}</span>
            {item.status !== "completed" ? (
              <span
                className={cn(
                  "rounded-full border px-1.5 py-0.5 font-mono text-3xs",
                  item.status === "failed"
                    ? "border-destructive/40 text-destructive"
                    : "border-border/70 text-muted-foreground",
                )}
              >
                {item.status}
              </span>
            ) : null}
            {visibility !== "local" ? (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-3xs text-muted-foreground">
                {visibility === "inherited" ? "Inherited" : "Synthetic"}
              </span>
            ) : null}
          </div>
          {presentation.detail ? (
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              <ChatMarkdown
                text={presentation.detail}
                cwd={ctx.markdownCwd}
                threadRef={ctx.threadRef ?? undefined}
                skills={ctx.skills}
                lineBreaks
              />
            </div>
          ) : null}
          {visibility === "inherited" ? (
            <p className="mt-1 font-mono text-3xs text-muted-foreground/65">
              From {sourceThreadId}
            </p>
          ) : null}
          <div className="mt-2">
            <V2ItemInspector
              projectedItem={row.projectedItem}
              environmentId={ctx.activeThreadEnvironmentId}
              cwd={ctx.markdownCwd}
              workspaceRoot={ctx.workspaceRoot}
              onOpenThread={ctx.onOpenThread}
              onOpenTurnDiff={ctx.onOpenTurnDiff}
              onImageExpand={ctx.onImageExpand}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function V2ErrorEventRow({
  row,
  presentation,
}: {
  row: Extract<TimelineRow, { kind: "event" }>;
  presentation: ReturnType<typeof v2EventPresentation>;
}) {
  const ctx = use(TimelineRowCtx);
  const [open, setOpen] = useState(false);
  const { item, visibility, sourceThreadId } = row.projectedItem;
  const Icon = presentation.icon;
  return (
    <div
      className={cn(
        "rounded-md border",
        presentation.tone === "warning" && "border-warning/25 bg-warning/5",
        presentation.tone === "danger" && "border-destructive/25 bg-destructive/5",
        presentation.tone === "success" && "border-success/20 bg-success/5",
      )}
      data-v2-item-type={item.type}
      data-v2-item-visibility={visibility}
      data-v2-event-disclosure="true"
    >
      <Collapsible
        open={open}
        onOpenChange={(next) => {
          ctx.onToggleWorkEntry(row.id, !next);
          setOpen(next);
        }}
      >
        <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left text-xs">
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              presentation.tone === "warning" && "text-warning",
              presentation.tone === "danger" && "text-destructive",
              presentation.tone === "success" && "text-success",
            )}
          />
          <span className="shrink-0 font-medium text-foreground/90">{presentation.label}</span>
          {item.status !== "completed" ? (
            <span
              className={cn(
                "shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-3xs",
                item.status === "failed"
                  ? "border-destructive/40 text-destructive"
                  : "border-border/70 text-muted-foreground",
              )}
            >
              {item.status}
            </span>
          ) : null}
          {presentation.detail ? (
            <span className="min-w-0 flex-1 truncate text-muted-foreground/65">
              {presentation.detail}
            </span>
          ) : null}
          {visibility !== "local" ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-3xs text-muted-foreground">
              {visibility === "inherited" ? "Inherited" : "Synthetic"}
            </span>
          ) : null}
          <span className="flex shrink-0 text-muted-foreground/60">
            <DisclosureChevron open={open} />
          </span>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="border-t border-border/45 px-3 py-2 ps-8">
            {presentation.detail ? (
              <div className="text-xs leading-relaxed text-muted-foreground">
                <ChatMarkdown
                  text={presentation.detail}
                  cwd={ctx.markdownCwd}
                  threadRef={ctx.threadRef ?? undefined}
                  skills={ctx.skills}
                  lineBreaks
                />
              </div>
            ) : null}
            {visibility === "inherited" ? (
              <p className="mt-1 font-mono text-3xs text-muted-foreground/65">
                From {sourceThreadId}
              </p>
            ) : null}
            <div className={presentation.detail ? "mt-2" : undefined}>
              <V2ItemInspector
                projectedItem={row.projectedItem}
                environmentId={ctx.activeThreadEnvironmentId}
                cwd={ctx.markdownCwd}
                workspaceRoot={ctx.workspaceRoot}
                onOpenThread={ctx.onOpenThread}
                onOpenTurnDiff={ctx.onOpenTurnDiff}
                onImageExpand={ctx.onImageExpand}
              />
            </div>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}

const V2SubagentGroup = memo(function V2SubagentGroup({
  row,
}: {
  row: Extract<TimelineRow, { kind: "event" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const groupId = `subagent-group:${row.id}`;
  const [expanded, setExpanded] = useState(() =>
    ctx.workGroupViewState.expandedEntries.has(groupId),
  );
  const members = (row.subagents ?? [row.projectedItem]).flatMap(({ item }) =>
    item.type === "subagent" ? [item] : [],
  );
  const liveAgents = useAtomValue(
    environmentThreadDetails.threadAtom(
      scopeThreadRef(ctx.activeThreadEnvironmentId, row.projectedItem.item.threadId),
    ),
    (thread) => thread?.projection.subagents,
  );
  const agents = members.map((item) => {
    const live = liveAgents?.find((agent) => agent.id === item.subagentId);
    return {
      item,
      status: live?.status ?? item.status,
      startedAt: live?.startedAt ?? item.startedAt,
      completedAt: live?.completedAt ?? item.completedAt,
    };
  });
  const summary = subagentGroupSummary(agents);
  const label = `${members.length} ${members.length === 1 ? "subagent" : "subagents"}`;
  const statusSummary = summarizeSubagentStatuses(agents.map(({ status }) => status));
  const toggleExpanded = (open: boolean) => {
    ctx.onToggleWorkEntry(row.id, expanded);
    if (open) ctx.workGroupViewState.expandedEntries.add(groupId);
    else ctx.workGroupViewState.expandedEntries.delete(groupId);
    setExpanded(open);
  };
  return (
    <WorkLogBlock continues={row.continuesWorkLog}>
      <Collapsible open={expanded} onOpenChange={toggleExpanded} data-subagent-group>
        <CollapsibleTrigger
          aria-label={label}
          aria-description={statusSummary}
          className={cn(
            "flex w-full min-w-0 items-center gap-3 py-2 text-left transition-opacity hover:opacity-100",
            expanded || summary.active
              ? "text-foreground opacity-100"
              : "text-muted-foreground opacity-55",
          )}
        >
          <span className="flex shrink-0 items-center -space-x-1.5" aria-hidden>
            {agents.slice(0, 3).map(({ item, status }) => (
              <EnvironmentSubagentAvatar
                key={item.id}
                environmentId={ctx.activeThreadEnvironmentId}
                providerInstanceId={item.providerInstanceId}
                driver={item.driver}
                status={agents.length === 1 ? status : undefined}
              />
            ))}
            {agents.length > 3 ? (
              <span className="relative inline-flex size-6 items-center justify-center rounded-full bg-muted text-3xs font-medium text-muted-foreground ring-2 ring-background">
                +{agents.length - 3}
              </span>
            ) : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold">{label}</span>
            <span
              className={cn(
                "block truncate text-3xs text-muted-foreground",
                summary.active ? "text-info" : summary.failed && "text-destructive",
              )}
            >
              {statusSummary}
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            <SubagentElapsed agent={subagentGroupTiming(agents)} />
          </span>
          <span className="flex shrink-0 text-muted-foreground">
            <DisclosureChevron open={expanded} size="sm" />
          </span>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="py-1">
            <div className="rounded-lg border border-border/60 bg-card/30 p-1">
              {members.map((item) => (
                <V2LifecycleRow
                  environmentId={ctx.activeThreadEnvironmentId}
                  key={item.id}
                  item={item}
                  createdAt={row.createdAt}
                  timestampFormat={ctx.timestampFormat}
                  runs={ctx.runs}
                  onOpenThread={ctx.onOpenThread}
                />
              ))}
            </div>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </WorkLogBlock>
  );
});
