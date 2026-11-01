import { AuthSettingsWriteScope, type EnvironmentId } from "@supaterm/contracts";
import type { SourceControlDefinition } from "@supaterm/client-runtime/source-control-clients";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { InlineConfirmButton } from "../InlineConfirm";
import { ProviderSettingsForm } from "./ProviderSettingsForm";
import { useEnvironmentScope } from "../../state/session";

export function SourceControlHostSettings({
  environmentId,
  definition,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly definition: SourceControlDefinition & {
    readonly settings: NonNullable<SourceControlDefinition["settings"]>;
  };
  readonly onSaved: () => void;
}) {
  const saved = useEnvironmentSettings(
    environmentId,
    (settings) => settings.sourceControlHosts[definition.kind],
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: `save ${definition.label} settings`,
  });
  const [saving, setSaving] = useState(false);
  const canWriteSettings = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const formDefinition = { settingsSchema: definition.settings };
  const hasSaved = Object.values(saved ?? {}).some((value) => value !== "");

  const save = async (fields: Record<string, unknown>) => {
    setSaving(true);
    const result = await updateSettings({
      environmentId,
      input: { patch: { sourceControlHosts: { [definition.kind]: fields } } },
    });
    setSaving(false);
    if (result._tag === "Success") onSaved();
  };

  return (
    // Locked while saving, so an edit made mid-request is not overwritten by the saved value.
    <fieldset disabled={saving || !canWriteSettings} className="contents">
      {!canWriteSettings ? (
        <p className="text-xs text-muted-foreground">
          This connection cannot change host settings.
        </p>
      ) : null}
      <ProviderSettingsForm
        definition={formDefinition}
        value={saved ?? {}}
        idPrefix={`source-control-${definition.kind}-${environmentId}`}
        variant="settings"
        onChange={(next) => {
          const fields = next ?? {};
          const changed = Object.fromEntries(
            Object.entries(fields).filter(([key, value]) => saved?.[key] !== value),
          );
          const cleared = Object.keys(saved ?? {}).filter((key) => !(key in fields));
          void save({ ...changed, ...Object.fromEntries(cleared.map((key) => [key, ""])) });
        }}
      />
      {hasSaved ? (
        <div className="flex justify-end pt-2">
          <InlineConfirmButton
            size="xs"
            variant="outline"
            disabled={saving}
            label="Remove"
            confirmLabel="Confirm remove"
            tooltip={`Remove the saved ${definition.label} settings`}
            confirmTooltip={`Click again to remove the saved ${definition.label} settings and credentials.`}
            onConfirm={() =>
              void save(Object.fromEntries(Object.keys(saved ?? {}).map((key) => [key, ""])))
            }
          />
        </div>
      ) : null}
    </fieldset>
  );
}
