import type { CodexMicroJoystickDirection, CodexMicroLayout } from "@supaterm/contracts";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon } from "lucide-react";
import { useState } from "react";

import { codexMicroActionLabel } from "../../codexMicro/codexMicroCatalog";
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

const DIRECTIONS = [
  { value: "up", label: "Up", icon: ArrowUpIcon },
  { value: "right", label: "Right", icon: ArrowRightIcon },
  { value: "down", label: "Down", icon: ArrowDownIcon },
  { value: "left", label: "Left", icon: ArrowLeftIcon },
] as const satisfies ReadonlyArray<
  Omit<CodexMicroInputRow<CodexMicroJoystickDirection>, "assignment">
>;

export function CodexMicroStickDialog({
  layout,
  onChange,
  onClose,
}: {
  layout: CodexMicroLayout;
  onChange: (layout: CodexMicroLayout) => void;
  onClose: () => void;
}) {
  const [direction, setDirection] = useState<CodexMicroJoystickDirection>("up");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="w-full sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Analog stick</DialogTitle>
          <DialogDescription>Choose what each direction triggers</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-col">
          <CodexMicroInputEditor
            label="Directions"
            rows={DIRECTIONS.map((entry) => ({
              ...entry,
              assignment: codexMicroActionLabel(layout.analogStick[entry.value]),
            }))}
            selected={direction}
            onSelect={setDirection}
            assigned={layout.analogStick[direction]}
            onAssign={(action) =>
              onChange({ ...layout, analogStick: { ...layout.analogStick, [direction]: action } })
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
