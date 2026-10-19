import type { CodexMicroEncoderInput, CodexMicroLayout } from "@supaterm/contracts";
import { HandIcon, MousePointerClickIcon, RotateCcwIcon, RotateCwIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { CodexMicroInputEditor, type CodexMicroInputRow } from "./CodexMicroInputEditor";
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
] as const satisfies ReadonlyArray<Omit<CodexMicroInputRow<CodexMicroEncoderInput>, "assignment">>;

export function CodexMicroKnobDialog({
  layout,
  onChange,
  onClose,
}: {
  layout: CodexMicroLayout;
  onChange: (layout: CodexMicroLayout) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState<CodexMicroEncoderInput>("left");
  const custom = layout.encoderMode === "custom";
  const mode = codexMicroEncoderModeOption(layout.encoderMode);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="w-full sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Knob</DialogTitle>
          <DialogDescription>
            Choose an action for each turn, click, and long press
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-col">
          {custom ? null : (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {mode.label}: {mode.description} Assigning an action switches the knob to Custom.
            </p>
          )}
          <CodexMicroInputEditor
            label="Knob inputs"
            rows={INPUTS.map((entry) => ({
              ...entry,
              assignment: codexMicroEncoderInputLabel(layout, entry.value),
            }))}
            selected={input}
            onSelect={setInput}
            assigned={custom ? layout.encoder[input] : undefined}
            onAssign={(action) =>
              onChange(codexMicroLayoutWithEncoderAction(layout, input, action))
            }
          />
        </DialogPanel>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
