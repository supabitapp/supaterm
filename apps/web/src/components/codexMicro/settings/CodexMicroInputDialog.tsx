import type { CodexMicroAction } from "@supaterm/contracts";
import type { IconComponent } from "@supaterm/icons";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
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
import { CodexMicroActionPicker } from "./CodexMicroActionPicker";

export interface CodexMicroInputRow<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly icon: IconComponent;
}

export function CodexMicroInputDialog<Value extends string>({
  title,
  description,
  label,
  rows,
  getAssignmentLabel,
  getAction,
  onAssign,
  onClose,
  children,
}: {
  title: string;
  description: string;
  label: string;
  rows: readonly [CodexMicroInputRow<Value>, ...CodexMicroInputRow<Value>[]];
  getAssignmentLabel: (value: Value) => string;
  getAction: (value: Value) => CodexMicroAction | null | undefined;
  onAssign: (value: Value, action: CodexMicroAction | null) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [selected, setSelected] = useState<Value>(rows[0].value);
  const selectedRow = rows.find((row) => row.value === selected)!;
  const assignLabel = `Assign ${selectedRow.label.toLowerCase()}`;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="w-full sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-col">
          {children}
          <div role="group" aria-label={label} className="flex flex-col gap-0.5">
            {rows.map((row) => {
              const Icon = row.icon;
              return (
                <button
                  key={row.value}
                  type="button"
                  aria-pressed={row.value === selected}
                  className={cn(
                    "flex min-h-9 w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    row.value === selected && "bg-accent",
                  )}
                  onClick={() => setSelected(row.value)}
                >
                  <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 font-medium">{row.label}</span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {getAssignmentLabel(row.value)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-4 px-1">
              <h3 className="text-sm font-medium">{assignLabel}</h3>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {getAssignmentLabel(selected)}
              </span>
            </div>
            <CodexMicroActionPicker
              key={selected}
              label={assignLabel}
              selected={getAction(selected)}
              clearLabel="Clear assignment"
              onSelect={(action) => onAssign(selected, action)}
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
