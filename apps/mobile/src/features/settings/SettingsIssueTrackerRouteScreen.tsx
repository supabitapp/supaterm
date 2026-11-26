import { useAtomValue } from "@effect/atom-react";
import type { StaticScreenProps } from "@react-navigation/native";
import {
  hasIssueTrackerTeams,
  issueTrackerBindings,
  issueTrackerSummary,
} from "@supaterm/client-runtime/state/issue-trackers";
import { AuthSettingsWriteScope, type EnvironmentId } from "@supaterm/contracts";
import { T, useGT, useMessages } from "gt-react-native";
import type { ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useEnvironments } from "../../state/environments";
import { issueTrackerEnvironment } from "../../state/issueTrackers";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentsWithScope } from "../../state/session";
import {
  IssueTrackerCredentialForm,
  IssueTrackerProjectRows,
} from "./components/IssueTrackerSection";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import type { SettingsTarget } from "./settings-environment-filter";

/** The environment a detail page edits, once it is connected, and whether this session may. */
function useDetailEnvironment(environmentId: EnvironmentId) {
  const { environments } = useEnvironments();
  const environment = environments.find(
    (entry): entry is SettingsTarget =>
      entry.environmentId === environmentId &&
      entry.connection.phase === "connected" &&
      entry.serverConfig !== null,
  );
  const writable = useEnvironmentsWithScope(
    environment ? [environment] : [],
    AuthSettingsWriteScope,
  );
  return { environment, canWrite: writable.has(environmentId) };
}

function DetailPage(props: { readonly title: string; readonly children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <SettingsScreen title={props.title}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {props.children}
      </ScrollView>
    </SettingsScreen>
  );
}

const Unavailable = () => (
  <Text className="px-2 text-base text-foreground-muted">
    <T>Connect this environment to change its settings.</T>
  </Text>
);

export function SettingsIssueTrackerRouteScreen({
  route,
}: StaticScreenProps<{
  readonly environmentId: EnvironmentId;
  readonly tracker: string;
  readonly accountId?: string;
}>) {
  const messages = useMessages();
  const gt = useGT();
  const { environmentId } = route.params;
  const { environment, canWrite } = useDetailEnvironment(environmentId);
  const query = useEnvironmentQuery(
    issueTrackerEnvironment.connections({ environmentId, input: {} }),
  );
  const canEdit = useAtomValue(issueTrackerEnvironment.connect.permissionAtom(environmentId));
  const tracker = [...(query.data?.trackers ?? []), ...(query.data?.accounts ?? [])].find(
    (entry) => entry.tracker === route.params.tracker && entry.accountId === route.params.accountId,
  );
  const disabled = !canWrite || !canEdit;
  const usable = tracker?.connected === true && tracker.account !== null;
  const canAddAccount =
    tracker !== undefined &&
    route.params.accountId === undefined &&
    (tracker.connected ||
      (query.data?.accounts ?? []).some((account) => account.tracker === tracker.tracker)) &&
    environment?.serverConfig.environment.capabilities.issueTrackerAccounts === true;
  return (
    <DetailPage title={tracker?.displayName ?? gt("Issue tracker")}>
      {!environment || !tracker ? (
        <Unavailable />
      ) : (
        <>
          <Text selectable className="px-2 text-sm text-foreground-muted">
            {issueTrackerSummary(tracker, issueTrackerBindings(query.data), messages)}
          </Text>
          <SettingsSection title={tracker.credential.label}>
            <IssueTrackerCredentialForm
              environmentId={environmentId}
              tracker={tracker}
              disabled={disabled}
            />
          </SettingsSection>
          {usable && hasIssueTrackerTeams(tracker, issueTrackerBindings(query.data)) ? (
            <SettingsSection
              title={gt("Projects")}
              footer={gt(
                "Pick one or more {tracker} {scopes} for each project. Their issues list beside the repository's own, and agents file new issues in the first one unless asked for another.",
                { tracker: tracker.displayName, scopes: `${tracker.scopeNoun}s` },
              )}
            >
              <IssueTrackerProjectRows
                environmentId={environmentId}
                tracker={tracker}
                bindings={issueTrackerBindings(query.data)}
                refreshing={query.isPending}
                refreshFailed={query.error !== null}
                disabled={disabled}
              />
            </SettingsSection>
          ) : null}
          {canAddAccount ? (
            <SettingsSection
              title={gt("Another account")}
              footer={gt("Connect a second {tracker} workspace or user.", {
                tracker: tracker.displayName,
              })}
            >
              <IssueTrackerCredentialForm
                environmentId={environmentId}
                tracker={tracker}
                disabled={disabled}
                addAccount
              />
            </SettingsSection>
          ) : null}
        </>
      )}
    </DetailPage>
  );
}
