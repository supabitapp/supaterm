import type { AuthMcpClientAccess } from "@supaterm/contracts";

import { AppText as Text } from "../../components/ui/AppText";
import { ListChoiceRow as SettingsChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { RUNTIME_MODE_CHOICES } from "../threads/thread-settings-options";

/** The same five levels as web's access picker: read-only, then the runtime modes. */
const ACCESS_CHOICES: ReadonlyArray<{
  readonly access: AuthMcpClientAccess;
  readonly label: string;
  readonly description: string;
}> = [
  {
    access: "read-only",
    label: "Read only",
    description: "Read projects and threads. Cannot start, message or change anything.",
  },
  ...RUNTIME_MODE_CHOICES.map((choice) => ({ ...choice, access: choice.mode })),
];

export const linkAccessLabel = (access: AuthMcpClientAccess) =>
  ACCESS_CHOICES.find((choice) => choice.access === access)?.label ?? access;

export function LinkAccessPicker(props: {
  readonly value: AuthMcpClientAccess;
  readonly disabled: boolean;
  readonly onChange: (access: AuthMcpClientAccess) => void;
}) {
  return (
    <>
      <SettingsSection title="What agents here may do there">
        {ACCESS_CHOICES.map((choice, index) => (
          <SettingsChoiceRow
            key={choice.access}
            label={choice.label}
            description={choice.description}
            selected={choice.access === props.value}
            separated={index > 0}
            disabled={props.disabled}
            onPress={() => props.onChange(choice.access)}
          />
        ))}
      </SettingsSection>
      <Text className="font-sans text-xs text-foreground-muted">
        An agent here never gets more there than its own mode here either. Threads it starts there
        cannot change that environment's own threads, projects or settings.
      </Text>
    </>
  );
}
