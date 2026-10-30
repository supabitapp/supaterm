import { isSecretsFeatureEnabled } from "../../env";
import type { SecretProviderConfig, SecretProviderId } from "@supaterm/contracts";
import { KeyIcon, PlusIcon } from "@supaterm/icons";
import type { ComponentType } from "react";
import { AuthProvidersManageScope } from "@supaterm/contracts";
import { useEnvironmentScope } from "../../state/session";
import { useInlineConfirm } from "../../hooks/useInlineConfirm";
import { InlineConfirmLabel } from "../InlineConfirm";
import { useState } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import type { EnvironmentPresentation } from "../../state/environments";
import { Button } from "../ui/button";
import { SecretProviderDialog } from "./SecretProviderDialog";
import { classifySecretProvider } from "./SecretProviderDialog.logic";
import { useSettingsScope } from "./SettingsScopeContext";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { searchableSetting } from "./settingsSearch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const SECRET_PROVIDER_KINDS: Readonly<
  Record<string, { readonly name: string; readonly icon: ComponentType<{ className?: string }> }>
> = {
  one_password: { name: "1Password", icon: KeyIcon },
};

export function SecretsSettingsPanel() {
  const { scope, environment } = useSettingsScope();
  const connected = environment?.connection.phase === "connected";
  if (!isSecretsFeatureEnabled) return null;
  return (
    <SettingsPageContainer>
      {connected &&
      environment.serverConfig !== null &&
      environment.serverConfig.secretProviderSettings !== true ? (
        <SettingsSection {...searchableSetting("secret-providers")}>
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Update Supaterm on {environment.label} to manage its secret providers.
          </p>
        </SettingsSection>
      ) : connected ? (
        <EnvironmentSecretProviders
          key={environment.environmentId}
          environment={environment}
          projectScoped={scope.kind === "project" || scope.kind === "checkout"}
        />
      ) : (
        <SettingsSection {...searchableSetting("secret-providers")}>
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Connect an environment to manage its secret provider configuration.
          </p>
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}

function EnvironmentSecretProviders({
  environment,
  projectScoped,
}: {
  readonly environment: EnvironmentPresentation;
  readonly projectScoped: boolean;
}) {
  const environmentId = environment.environmentId;
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const readOnly = !canManage || projectScoped;
  const providers = useEnvironmentSettings(environmentId, (settings) => settings.secretProviders);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [dialog, setDialog] = useState<
    null | { readonly mode: "add" } | { readonly mode: "edit"; readonly id: SecretProviderId }
  >(null);
  const entries = Object.entries(providers) as Array<[SecretProviderId, SecretProviderConfig]>;
  const editingConfig = dialog?.mode === "edit" ? providers[dialog.id] : undefined;
  const editing =
    dialog?.mode === "edit" && editingConfig !== undefined
      ? { id: dialog.id, config: editingConfig }
      : undefined;
  return (
    <>
      <SettingsSection
        {...searchableSetting("secret-providers")}
        headerAction={
          !readOnly ? (
            <Button size="xs" variant="outline" onClick={() => setDialog({ mode: "add" })}>
              <PlusIcon className="size-3" aria-hidden />
              Add provider
            </Button>
          ) : null
        }
      >
        {projectScoped ? (
          <p className="px-4 pt-3 text-xs text-muted-foreground">
            Environment-wide setting. Select an environment to change it.
          </p>
        ) : null}
        {entries.length === 0 ? (
          <SettingsRow
            title="No secret providers configured."
            description="Add a 1Password account configuration. Secret resolution is not available yet."
          />
        ) : (
          entries.map(([id, config]) => {
            const classified = classifySecretProvider(config);
            const kind =
              classified.kind === "unsupported"
                ? undefined
                : SECRET_PROVIDER_KINDS[classified.kind];
            return (
              <SettingsRow
                key={id}
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    {kind ? (
                      <kind.icon className="size-4.5 shrink-0 text-foreground/80" aria-hidden />
                    ) : null}
                    <span className="min-w-0 wrap-anywhere">{config.label}</span>
                  </span>
                }
                description={
                  classified.kind === "one_password" && kind ? (
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="shrink-0">{kind.name} ·</span>
                      <RedactedSensitiveText
                        value={classified.account}
                        ariaLabel="Toggle account visibility"
                        revealTooltip="Click to reveal account"
                        hideTooltip="Click to hide account"
                        className="max-w-full truncate"
                      />
                    </span>
                  ) : (
                    `Unsupported provider (${config.kind})`
                  )
                }
                control={
                  !readOnly ? (
                    <div className="flex items-center gap-1">
                      {kind ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setDialog({ mode: "edit", id })}
                        >
                          Edit
                        </Button>
                      ) : null}
                      <RemoveSecretProviderButton
                        label={config.label}
                        onConfirm={() => updateSettings({ secretProviders: { [id]: null } })}
                      />
                    </div>
                  ) : null
                }
              />
            );
          })
        )}
      </SettingsSection>
      {dialog !== null && !readOnly && (dialog.mode === "add" || editing !== undefined) ? (
        <SecretProviderDialog
          onClose={() => setDialog(null)}
          environmentId={environmentId}
          environmentLabel={environment.label}
          existingIds={new Set(Object.keys(providers))}
          {...(editing === undefined ? {} : { existing: editing })}
        />
      ) : null}
    </>
  );
}

function RemoveSecretProviderButton({
  label,
  onConfirm,
}: {
  readonly label: string;
  readonly onConfirm: () => void;
}) {
  const confirm = useInlineConfirm<"remove">();
  const armed = confirm.armed === "remove";
  return (
    <Button
      size="xs"
      variant={armed ? "destructive" : "ghost"}
      aria-label={`Remove ${label}`}
      {...confirm.bind("remove", onConfirm)}
    >
      <InlineConfirmLabel armed={armed} idle="Remove" confirm="Remove provider?" />
    </Button>
  );
}
