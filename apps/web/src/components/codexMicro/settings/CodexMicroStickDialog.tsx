import type { CodexMicroJoystickDirection, CodexMicroLayout } from "@supaterm/contracts";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon } from "@supaterm/icons";
import { msg, useGT, useMessages } from "gt-react";

import { codexMicroActionLabel } from "../codexMicroCatalog";
import { CodexMicroInputDialog, type CodexMicroInputRow } from "./CodexMicroInputDialog";

const DIRECTIONS = [
  {
    value: "up",
    label: msg("Up", { $context: "analog stick direction" }),
    assignLabel: msg("Assign up"),
    icon: ArrowUpIcon,
  },
  {
    value: "right",
    label: msg("Right", { $context: "analog stick direction" }),
    assignLabel: msg("Assign right"),
    icon: ArrowRightIcon,
  },
  {
    value: "down",
    label: msg("Down", { $context: "analog stick direction" }),
    assignLabel: msg("Assign down"),
    icon: ArrowDownIcon,
  },
  {
    value: "left",
    label: msg("Left", { $context: "analog stick direction" }),
    assignLabel: msg("Assign left"),
    icon: ArrowLeftIcon,
  },
] as const satisfies ReadonlyArray<CodexMicroInputRow<CodexMicroJoystickDirection>>;

export function CodexMicroStickDialog({
  layout,
  onChange,
  onClose,
}: {
  layout: CodexMicroLayout;
  onChange: (layout: CodexMicroLayout) => void;
  onClose: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  return (
    <CodexMicroInputDialog
      title={gt("Analog stick")}
      description={gt("Choose what each direction triggers")}
      label={gt("Directions")}
      rows={DIRECTIONS}
      getAssignmentLabel={(direction) => codexMicroActionLabel(layout.analogStick[direction], m)}
      getAction={(direction) => layout.analogStick[direction]}
      onAssign={(direction, action) =>
        onChange({ ...layout, analogStick: { ...layout.analogStick, [direction]: action } })
      }
      onClose={onClose}
    />
  );
}
