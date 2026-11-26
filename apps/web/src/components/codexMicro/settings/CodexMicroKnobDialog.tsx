import type { CodexMicroEncoderInput, CodexMicroLayout } from "@supaterm/contracts";
import { HandIcon, MousePointerClickIcon, RotateCcwIcon, RotateCwIcon } from "@supaterm/icons";
import { msg, T, useGT, useMessages, Var } from "gt-react";

import { CodexMicroInputDialog, type CodexMicroInputRow } from "./CodexMicroInputDialog";
import {
  codexMicroEncoderInputLabel,
  codexMicroEncoderModeOption,
  codexMicroLayoutWithEncoderAction,
} from "./CodexMicroSettings.logic";

const INPUTS = [
  {
    value: "left",
    label: msg("Turn left"),
    assignLabel: msg("Assign turn left"),
    icon: RotateCcwIcon,
  },
  {
    value: "right",
    label: msg("Turn right"),
    assignLabel: msg("Assign turn right"),
    icon: RotateCwIcon,
  },
  {
    value: "click",
    label: msg("Click", { $context: "knob input" }),
    assignLabel: msg("Assign click"),
    icon: MousePointerClickIcon,
  },
  {
    value: "longPress",
    label: msg("Press and hold"),
    assignLabel: msg("Assign press and hold"),
    icon: HandIcon,
  },
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
  const gt = useGT();
  const m = useMessages();
  const custom = layout.encoderMode === "custom";
  const mode = codexMicroEncoderModeOption(layout.encoderMode);

  return (
    <CodexMicroInputDialog
      title={gt("Knob")}
      description={gt("Choose an action for each turn, click, and long press")}
      label={gt("Knob inputs")}
      rows={INPUTS}
      getAssignmentLabel={(input) => codexMicroEncoderInputLabel(layout, input, m)}
      getAction={(input) => (custom ? layout.encoder[input] : undefined)}
      onAssign={(input, action) =>
        onChange(codexMicroLayoutWithEncoderAction(layout, input, action))
      }
      onClose={onClose}
    >
      {custom ? null : (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <T>
            <Var>{m(mode.label)}</Var>: <Var>{m(mode.description)}</Var> Assigning an action
            switches the knob to Custom.
          </T>
        </p>
      )}
    </CodexMicroInputDialog>
  );
}
