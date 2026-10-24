import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type PushPreviewLevel,
  type PushRegistrationSummary,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { XIcon } from "lucide-react";
import { useState } from "react";

import { type EnvironmentQueryView, useEnvironmentQuery } from "../../state/query";
import { pushEnvironment } from "../../state/push";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { InlineConfirmButton } from "../InlineConfirm";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { addPushGatewayOrigin } from "./PushNotificationSettings.logic";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const PREVIEW_LABELS = {
  hidden: "Content hidden",
  titles: "Titles only",
  full: "Full previews",
} satisfies Record<PushPreviewLevel, string>;

export function PushNotificationSettings() {
  const enabled = useScopedSettings((settings) => settings.pushNotificationsEnabled);
  const update = useUpdateScopedSettings();
  const { connectedEnvironments } = useSettingsScope();

  return (
    <SettingsSection title="Push notifications">
      <SettingsRow
        {...searchableSetting("push-notifications")}
        serverScoped
        settingKeys={["pushNotificationsEnabled"]}
        description="Sends alerts to phones that turn on push in the Supaterm iOS app. Notification content is end-to-end encrypted, so the push gateway never sees it."
        control={
          <Switch
            checked={enabled}
            onCheckedChange={(pushNotificationsEnabled) => update({ pushNotificationsEnabled })}
            aria-label="Push notifications"
          />
        }
      />
      <PushGatewayOrigins />
      {connectedEnvironments.map((environment, index) => (
        <PushDevices
          key={environment.environmentId}
          searchAnchor={index === 0}
          environmentId={environment.environmentId}
          environmentLabel={
            connectedEnvironments.length > 1
              ? settingsScopeEnvironmentLabel(environment, connectedEnvironments)
              : null
          }
        />
      ))}
    </SettingsSection>
  );
}

function PushGatewayOrigins() {
  const origins = useScopedSettings((settings) => settings.pushGatewayOrigins);
  const update = useUpdateScopedSettings();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const defaults = DEFAULT_SERVER_SETTINGS.pushGatewayOrigins;
  const isDefault =
    origins.length === defaults.length &&
    origins.every((origin, index) => origin === defaults[index]);

  return (
    <SettingsRow
      {...searchableSetting("push-gateways")}
      serverScoped
      settingKeys={["pushGatewayOrigins"]}
      description={
        error ??
        "Phones can register only through these gateways. A gateway relays sealed notifications and never holds the keys to open them."
      }
      resetAction={
        isDefault ? null : (
          <SettingResetButton
            label="push gateways"
            onClick={() => update({ pushGatewayOrigins: [...defaults] })}
          />
        )
      }
      control={
        <form
          className="flex w-full items-center gap-2 sm:w-80"
          onSubmit={(event) => {
            event.preventDefault();
            const result = addPushGatewayOrigin(origins, draft);
            if ("error" in result) {
              setError(result.error);
              return;
            }
            update({ pushGatewayOrigins: [...result.origins] });
            setDraft("");
            setError(null);
          }}
        >
          <Input
            size="sm"
            font="mono"
            aria-label="Push gateway origin"
            aria-invalid={error !== null}
            placeholder="https://push.example.com"
            value={draft}
            onValueChange={(value) => {
              setDraft(value);
              setError(null);
            }}
          />
          <Button type="submit" size="sm" variant="outline" disabled={draft.trim() === ""}>
            Add
          </Button>
        </form>
      }
    >
      <div className="divide-y divide-border/60 border-y border-border/60">
        {origins.map((origin) => (
          <div key={origin} className="flex min-w-0 items-center justify-between gap-3 py-1.5">
            <code className="truncate text-xs text-foreground">{origin}</code>
            <InlineConfirmButton
              size="icon-xs"
              variant="ghost-muted"
              icon={<XIcon />}
              label={`Remove ${origin}`}
              confirmLabel={`Confirm remove ${origin}`}
              tooltip="Remove gateway"
              confirmTooltip="Click again to remove. Phones registered through this gateway stop getting notifications until it is added back."
              onConfirm={() =>
                update({ pushGatewayOrigins: origins.filter((value) => value !== origin) })
              }
            />
          </div>
        ))}
        {origins.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">
            No gateways allowed. Phones cannot register for push.
          </p>
        ) : null}
      </div>
    </SettingsRow>
  );
}

function PushDevices({
  searchAnchor,
  environmentId,
  environmentLabel,
}: {
  readonly searchAnchor: boolean;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string | null;
}) {
  const canRead = useAtomValue(pushEnvironment.registrations.permissionAtom(environmentId));
  const canRemove = useAtomValue(pushEnvironment.revoke.permissionAtom(environmentId));
  const query = useEnvironmentQuery(
    canRead ? pushEnvironment.registrations({ environmentId, input: {} }) : null,
  );
  const sendTest = useAtomCommand(pushEnvironment.test);
  const revoke = useAtomCommand(pushEnvironment.revoke);
  const [pending, setPending] = useState<string | null>(null);
  const registrations = query.data?.registrations ?? [];
  const searchProps = searchableSetting("push-devices");
  const title = environmentLabel
    ? `${searchProps.title} on ${environmentLabel}`
    : searchProps.title;

  const runTest = async (registration: PushRegistrationSummary) => {
    setPending(registration.registrationId);
    const result = await sendTest({
      environmentId,
      input: { registrationId: registration.registrationId },
    });
    setPending(null);
    if (result._tag === "Failure") return;
    const name = registration.deviceName;
    switch (result.value.status) {
      case "accepted":
        toastManager.add({
          type: "success",
          title: name ? `Test notification sent to ${name}` : "Test notification sent",
        });
        return;
      case "gone":
        toastManager.add({
          type: "warning",
          title: `${name ?? "This device"} no longer accepts notifications`,
          description: "Turn push off and on again in the Supaterm iOS app to register it again.",
        });
        return;
      case "failed":
        toastManager.add({
          type: "error",
          title: "Test notification not sent",
          description: "The push gateway did not accept it. Try again in a moment.",
        });
    }
  };

  const remove = async (registration: PushRegistrationSummary) => {
    setPending(registration.registrationId);
    await revoke({ environmentId, input: { registrationId: registration.registrationId } });
    setPending(null);
  };

  return (
    <SettingsRow
      id={searchAnchor ? searchProps.id : undefined}
      title={title}
      description={describeDevices(canRead, query, registrations.length)}
    >
      {registrations.length > 0 ? (
        <div className="divide-y divide-border/60 border-y border-border/60">
          {registrations.map((registration) => (
            <div
              key={registration.registrationId}
              className="flex min-w-0 items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-xs text-foreground">
                    {registration.deviceName ?? registration.sessionLabel ?? "Unnamed device"}
                  </p>
                  {registration.isCurrentSession ? (
                    <Badge variant="outline" size="sm">
                      This session
                    </Badge>
                  ) : null}
                  {registration.status === "gone" ? (
                    <Badge variant="warning" size="sm">
                      Inactive
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate text-3xs text-muted-foreground">
                  {describeRegistration(registration)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost-muted"
                  disabled={pending !== null || registration.status !== "active"}
                  onClick={() => void runTest(registration)}
                >
                  {pending === registration.registrationId ? "Sending…" : "Send test"}
                </Button>
                {canRemove ? (
                  <InlineConfirmButton
                    size="xs"
                    variant="ghost-muted"
                    disabled={pending !== null}
                    label="Remove"
                    confirmLabel="Confirm remove"
                    tooltip="Stop sending notifications to this device"
                    confirmTooltip="Click again to remove. The device can register again from the Supaterm iOS app."
                    onConfirm={() => void remove(registration)}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </SettingsRow>
  );
}

function describeDevices(
  canRead: boolean,
  query: EnvironmentQueryView<unknown>,
  count: number,
): string {
  if (!canRead) return "This connection cannot view push devices.";
  if (query.error) return query.error;
  if (query.isPending && query.data === null) return "Loading devices…";
  if (count === 0)
    return "No devices yet. Turn on notifications in the Supaterm iOS app to add one.";
  return "Phones that receive this environment's notifications.";
}

function describeRegistration(registration: PushRegistrationSummary): string {
  return [
    registration.gatewayOrigin.replace(/^https?:\/\//, ""),
    PREVIEW_LABELS[registration.preview],
    `Added ${formatRelativeTimeLabel(DateTime.formatIso(registration.createdAt))}`,
    registration.lastDeliveryAt
      ? `Last delivery ${formatRelativeTimeLabel(DateTime.formatIso(registration.lastDeliveryAt))}`
      : "No deliveries yet",
  ].join(" · ");
}
