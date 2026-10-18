import { scopeProjectRef, scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  normalizeProviderAccentColor,
  resolveProviderInstanceDisplayName,
  shouldShowInstanceBadge,
} from "@supaterm/client-runtime/state/provider-instance-display";
import { resolveSubagentMetadata } from "@supaterm/client-runtime/state/subagent-display";
import type { EnvironmentId, OrchestrationV2Subagent } from "@supaterm/contracts";
import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ProviderIcon } from "../../components/ProviderIcon";
import { cn } from "../../lib/cn";
import { useEnvironmentServerConfig, useProject, useThreadShell } from "../../state/entities";
import { subagentCardDetail } from "./subagent-card-presentation";
import { SUBAGENT_TONE_TEXT_CLASS, SubagentStatusDot } from "./SubagentStatusDot";
import {
  resolveSubagentRowPresentation,
  type SubagentRowPresentation,
} from "./threadAgentsPresentation";

type SubagentRowSubagent = Pick<
  OrchestrationV2Subagent,
  | "threadId"
  | "childThreadId"
  | "model"
  | "driver"
  | "providerInstanceId"
  | "title"
  | "prompt"
  | "status"
  | "progress"
  | "result"
>;

export function SubagentRow(props: {
  readonly environmentId: EnvironmentId;
  readonly subagent: SubagentRowSubagent;
  readonly elapsed: ReactNode;
}) {
  const presentation = resolveSubagentRowPresentation(props.subagent);
  const detail = subagentCardDetail(presentation.detail);
  return (
    <View className="flex-row gap-3">
      <View className="h-5 justify-center">
        <SubagentStatusDot tone={presentation.tone} placement="sheet" />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <View className="min-h-5 flex-row items-center gap-2">
          <Text
            numberOfLines={1}
            className="min-w-0 flex-1 font-supaterm-medium text-sm text-foreground"
          >
            {presentation.title}
          </Text>
          {props.elapsed}
          {presentation.canOpenThread ? (
            <SymbolView name="chevron.right" size={12} tintColorClassName="accent-icon-subtle" />
          ) : null}
        </View>
        <SubagentMetadata
          environmentId={props.environmentId}
          subagent={props.subagent}
          presentation={presentation}
        />
        {detail ? (
          <Text
            numberOfLines={3}
            className={cn(
              "text-xs text-foreground-muted",
              presentation.tone === "failed" && SUBAGENT_TONE_TEXT_CLASS.failed,
            )}
          >
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function SubagentMetadata(props: {
  readonly environmentId: EnvironmentId;
  readonly subagent: SubagentRowSubagent;
  readonly presentation: Pick<SubagentRowPresentation, "statusLabel" | "tone">;
}) {
  const { environmentId, subagent, presentation } = props;
  const config = useEnvironmentServerConfig(environmentId);
  const provider = config?.providers.find(
    (candidate) => candidate.instanceId === subagent.providerInstanceId,
  );
  const parent = useThreadShell(scopeThreadRef(environmentId, subagent.threadId))?.source;
  const child = useThreadShell(
    subagent.childThreadId === null ? null : scopeThreadRef(environmentId, subagent.childThreadId),
  )?.source;
  const parentProject = useProject(
    parent ? scopeProjectRef(environmentId, parent.projectId) : null,
  );
  const childProject = useProject(child ? scopeProjectRef(environmentId, child.projectId) : null);
  const { modelLabel, workspace } = resolveSubagentMetadata({
    model: subagent.model,
    provider,
    parentThread: parent,
    childThread: child,
    parentProject,
    childProject,
  });
  const showInstanceName =
    provider !== undefined &&
    shouldShowInstanceBadge(
      {
        driverKind: provider.driver,
        accentColor: normalizeProviderAccentColor(provider.accentColor),
      },
      config?.providers.map((candidate) => ({ driverKind: candidate.driver })) ?? [],
    );
  return (
    <View className="min-w-0 flex-row items-center gap-1.5">
      <Text
        className={cn(
          "shrink-0 font-supaterm-medium text-xs",
          SUBAGENT_TONE_TEXT_CLASS[presentation.tone],
        )}
      >
        {presentation.statusLabel}
      </Text>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        className="text-xs text-foreground-muted"
      >
        ·
      </Text>
      <ProviderIcon
        provider={provider?.driver ?? subagent.driver}
        iconUrl={provider?.iconUrl}
        size={12}
      />
      <Text className="min-w-0 shrink text-xs text-foreground-muted" numberOfLines={1}>
        {showInstanceName
          ? `${modelLabel} · ${resolveProviderInstanceDisplayName(provider)}`
          : modelLabel}
      </Text>
      {workspace.map(({ label, value }) => (
        // The row reads this label in place of the icon. collapsable keeps the
        // view (and label) from being flattened away without making it a
        // separate accessibility stop.
        <View
          key={label}
          collapsable={false}
          accessibilityLabel={`${label}: ${value}`}
          className="min-w-0 shrink flex-row items-center gap-1.5"
        >
          <Text className="text-xs text-foreground-muted">·</Text>
          <SymbolView
            name={label === "Branch" ? "arrow.triangle.branch" : "folder"}
            size={11}
            tintColorClassName="accent-icon-muted"
          />
          <Text className="min-w-0 shrink text-xs text-foreground-muted" numberOfLines={1}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}
