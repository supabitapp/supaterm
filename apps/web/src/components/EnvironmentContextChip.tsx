import { type EnvironmentContextRecord, resolveEnvironmentMachineKind } from "@supaterm/contracts";

import { useEnvironment } from "~/state/environments";
import { ContextChipShell } from "./contextChipParts";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";

/** Prefers the name this client knows the machine by over the label the mention was sent with. */
export function EnvironmentContextChip(props: {
  record: Pick<EnvironmentContextRecord, "environmentId" | "label">;
  copyMarkdown?: string | undefined;
}) {
  const environment = useEnvironment(props.record.environmentId);
  const label = environment?.label.trim() || props.record.label;
  return (
    <ContextChipShell
      kind="environment"
      icon={
        <EnvironmentMachineIcon
          kind={resolveEnvironmentMachineKind(environment?.serverConfig ?? null)}
        />
      }
      label={label}
      aria-label={`Machine, ${label}`}
      data-markdown-copy={props.copyMarkdown}
      tooltip={environment ? "Supaterm environment" : "Machine not in this app"}
    />
  );
}
