import type { CodexMicroAction } from "@supaterm/contracts";
import type { LucideIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { CodexMicroActionPicker } from "./CodexMicroActionPicker";

export interface CodexMicroInputRow<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly assignment: string;
}

/** The inputs of one control, each with what it currently triggers, and a picker for the chosen one. */
export function CodexMicroInputEditor<Value extends string>({
  label,
  rows,
  selected,
  onSelect,
  assigned,
  onAssign,
}: {
  label: string;
  rows: ReadonlyArray<CodexMicroInputRow<Value>>;
  selected: Value;
  onSelect: (value: Value) => void;
  /** `null` marks the clear row as current; `undefined` marks nothing. */
  assigned: CodexMicroAction | null | undefined;
  onAssign: (action: CodexMicroAction | null) => void;
}) {
  const selectedRow = rows.find((row) => row.value === selected)!;
  const assignLabel = `Assign ${selectedRow.label.toLowerCase()}`;

  return (
    <>
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
              onClick={() => onSelect(row.value)}
            >
              <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 font-medium">{row.label}</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {row.assignment}
              </span>
            </button>
          );
        })}
      </div>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-4 px-1">
          <h3 className="text-sm font-medium">{assignLabel}</h3>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {selectedRow.assignment}
          </span>
        </div>
        <CodexMicroActionPicker
          key={selected}
          label={assignLabel}
          selected={assigned}
          clearLabel="Clear assignment"
          onSelect={onAssign}
        />
      </div>
    </>
  );
}
