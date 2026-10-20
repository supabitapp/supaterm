import type { CodexMicroJoystickDirection, CodexMicroLayout } from "@supaterm/contracts";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon } from "lucide-react";

import { codexMicroActionLabel } from "../codexMicroCatalog";
import { CodexMicroInputDialog, type CodexMicroInputRow } from "./CodexMicroInputDialog";

const DIRECTIONS = [
  { value: "up", label: "Up", icon: ArrowUpIcon },
  { value: "right", label: "Right", icon: ArrowRightIcon },
  { value: "down", label: "Down", icon: ArrowDownIcon },
  { value: "left", label: "Left", icon: ArrowLeftIcon },
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
  return (
    <CodexMicroInputDialog
      title="Analog stick"
      description="Choose what each direction triggers"
      label="Directions"
      rows={DIRECTIONS}
      getAssignmentLabel={(direction) => codexMicroActionLabel(layout.analogStick[direction])}
      getAction={(direction) => layout.analogStick[direction]}
      onAssign={(direction, action) =>
        onChange({ ...layout, analogStick: { ...layout.analogStick, [direction]: action } })
      }
      onClose={onClose}
    />
  );
}
