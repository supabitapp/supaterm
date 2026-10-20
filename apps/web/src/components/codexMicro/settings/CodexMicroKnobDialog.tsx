import type { CodexMicroEncoderInput, CodexMicroLayout } from "@supaterm/contracts";
import { HandIcon, MousePointerClickIcon, RotateCcwIcon, RotateCwIcon } from "lucide-react";

import { CodexMicroInputDialog, type CodexMicroInputRow } from "./CodexMicroInputDialog";
import {
  codexMicroEncoderInputLabel,
  codexMicroEncoderModeOption,
  codexMicroLayoutWithEncoderAction,
} from "./CodexMicroSettings.logic";

const INPUTS = [
  { value: "left", label: "Turn left", icon: RotateCcwIcon },
  { value: "right", label: "Turn right", icon: RotateCwIcon },
  { value: "click", label: "Click", icon: MousePointerClickIcon },
  { value: "longPress", label: "Press and hold", icon: HandIcon },
] as const satisfies ReadonlyArray<CodexMicroInputRow<CodexMicroEncoderInput>>;

export function CodexMicroKnobDialog({
  layout,
  onChange,
  onClose,
}: {
  layout: CodexMicroLayout;
  onChange: (layout: CodexMicroLayout) => void;
  onClose: () => void;
}) {
  const custom = layout.encoderMode === "custom";
  const mode = codexMicroEncoderModeOption(layout.encoderMode);

  return (
    <CodexMicroInputDialog
      title="Knob"
      description="Choose an action for each turn, click, and long press"
      label="Knob inputs"
      rows={INPUTS}
      getAssignmentLabel={(input) => codexMicroEncoderInputLabel(layout, input)}
      getAction={(input) => (custom ? layout.encoder[input] : undefined)}
      onAssign={(input, action) =>
        onChange(codexMicroLayoutWithEncoderAction(layout, input, action))
      }
      onClose={onClose}
    >
      {custom ? null : (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {mode.label}: {mode.description} Assigning an action switches the knob to Custom.
        </p>
      )}
    </CodexMicroInputDialog>
  );
}
