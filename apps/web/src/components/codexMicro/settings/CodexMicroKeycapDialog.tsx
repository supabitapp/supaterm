import type {
  CodexMicroAction,
  CodexMicroActionSlot,
  CodexMicroKeycapId,
  CodexMicroLayout,
} from "@supaterm/contracts";
import { useState } from "react";

import { cn } from "~/lib/utils";
import {
  assignCodexMicroKeycap,
  CODEX_MICRO_COMMAND_GROUPS,
  codexMicroActionLabel,
  codexMicroKeycap,
  codexMicroKeycapHolder,
  codexMicroKeycapsForSlot,
  type CodexMicroCommandOption,
  type CodexMicroKeycap,
} from "../codexMicroCatalog";
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
import { Input } from "../../ui/input";
import { ScrollArea } from "../../ui/scroll-area";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import {
  codexMicroActionValue,
  codexMicroSlotName,
  filterCodexMicroKeycaps,
} from "./CodexMicroSettings.logic";

const DEFAULT_CHOICE = "default";
const DEFAULT_CHOICE_LABEL = "Use keycap default";
const TEXT_CHOICE = "text";
const TEXT_CHOICE_LABEL = "Insert text…";
const MAX_TEXT_LENGTH = 500;

const COMMAND_OPTIONS = new Map<string, CodexMicroCommandOption>(
  CODEX_MICRO_COMMAND_GROUPS.flatMap((group) =>
    group.options.map((option) => [codexMicroActionValue(option.action), option] as const),
  ),
);

function initialChoice(action: CodexMicroAction | undefined): string {
  if (action === undefined) return DEFAULT_CHOICE;
  return action.type === "composer-text" ? TEXT_CHOICE : codexMicroActionValue(action);
}

/** `undefined` keeps the keycap default; `null` is an incomplete choice that can't be saved. */
function chosenAction(
  choice: string,
  text: string,
  preservedAction: CodexMicroAction | null,
): CodexMicroAction | undefined | null {
  if (choice === DEFAULT_CHOICE) return undefined;
  if (choice === TEXT_CHOICE) {
    const trimmed = text.trim();
    return trimmed.length > 0 ? { type: "composer-text", text: trimmed } : null;
  }
  return COMMAND_OPTIONS.get(choice)?.action ?? preservedAction;
}

function choiceLabel(choice: string, action: CodexMicroAction | undefined | null): string {
  if (choice === DEFAULT_CHOICE) return DEFAULT_CHOICE_LABEL;
  if (choice === TEXT_CHOICE) return TEXT_CHOICE_LABEL;
  return codexMicroActionLabel(action ?? null);
}

function KeycapTile({
  keycap,
  selected,
  onSelect,
}: {
  keycap: CodexMicroKeycap;
  selected: boolean;
  onSelect: (id: CodexMicroKeycapId) => void;
}) {
  const Icon = keycap.icon;
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "flex h-16 flex-col items-center justify-center gap-1.5 rounded-lg border bg-card outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        keycap.size === "double" && "col-span-2",
        selected ? "border-ring bg-accent text-foreground" : "border-border/70 text-foreground/80",
      )}
      onClick={() => onSelect(keycap.id)}
    >
      {Icon ? (
        <Icon aria-hidden className="size-4" />
      ) : (
        <span aria-hidden className="font-mono text-2xs">
          {keycap.glyph}
        </span>
      )}
      <span className="font-mono text-2xs">{keycap.label}</span>
    </button>
  );
}

export function CodexMicroKeycapDialog({
  slot,
  layout,
  onSave,
  onClose,
}: {
  slot: CodexMicroActionSlot;
  layout: CodexMicroLayout;
  onSave: (layout: CodexMicroLayout) => void;
  onClose: () => void;
}) {
  const current = layout.slots[slot];
  const currentChoice = initialChoice(current.action);
  const [keycapId, setKeycapId] = useState(current.keycapId);
  const [choice, setChoice] = useState(currentChoice);
  const [text, setText] = useState(
    current.action?.type === "composer-text" ? current.action.text : "",
  );
  const [query, setQuery] = useState("");
  const keycaps = filterCodexMicroKeycaps(codexMicroKeycapsForSlot(slot), query);
  const keycap = codexMicroKeycap(keycapId);
  const holder = codexMicroKeycapHolder(layout, slot, keycapId);
  // An action the picker doesn't list stays selectable, so saving the keycap alone keeps it.
  const preservedAction =
    current.action !== undefined &&
    currentChoice !== TEXT_CHOICE &&
    !COMMAND_OPTIONS.has(currentChoice)
      ? current.action
      : null;
  const action = chosenAction(choice, text, preservedAction);
  const effectiveAction = action === undefined ? keycap.defaultAction : action;

  const save = () => {
    if (action === null) return;
    onSave(
      assignCodexMicroKeycap(
        layout,
        slot,
        action === undefined ? { keycapId } : { keycapId, action },
      ),
    );
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="w-full sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit keycap</DialogTitle>
          <DialogDescription>Choose what appears on {codexMicroSlotName(slot)}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-col">
          <Input
            type="search"
            value={query}
            aria-label="Search keycaps"
            placeholder="Search keycaps"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <ScrollArea scrollFade className="max-h-80">
            <div
              role="group"
              aria-label="Keycaps"
              className="grid grid-cols-4 gap-2 p-0.5 sm:grid-cols-6"
            >
              {keycaps.map((entry) => (
                <KeycapTile
                  key={entry.id}
                  keycap={entry}
                  selected={entry.id === keycapId}
                  onSelect={setKeycapId}
                />
              ))}
            </div>
            {keycaps.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No keycaps found.</p>
            ) : null}
          </ScrollArea>
          {holder ? (
            <p className="text-xs text-muted-foreground">
              {keycap.label} is on {codexMicroSlotName(holder)}. Saving swaps the two keycaps.
            </p>
          ) : null}
          <div className="space-y-3 rounded-xl border border-border/60 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0 space-y-0.5">
                <h3 className="text-sm font-medium">Assigned action</h3>
                <p className="text-xs text-muted-foreground">
                  {keycap.defaultAction
                    ? `Keycap default: ${codexMicroActionLabel(keycap.defaultAction)}`
                    : "No default action"}
                </p>
              </div>
              <Select
                value={choice}
                onValueChange={(value) => {
                  if (typeof value === "string") setChoice(value);
                }}
              >
                <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Assigned action">
                  <SelectValue>{choiceLabel(choice, action)}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value={DEFAULT_CHOICE}>
                    {DEFAULT_CHOICE_LABEL}
                  </SelectItem>
                  {preservedAction ? (
                    <SelectItem hideIndicator value={currentChoice}>
                      {codexMicroActionLabel(preservedAction)}
                    </SelectItem>
                  ) : null}
                  {CODEX_MICRO_COMMAND_GROUPS.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectGroupLabel>{group.label}</SelectGroupLabel>
                      {group.options.map((option) => (
                        <SelectItem
                          hideIndicator
                          key={codexMicroActionValue(option.action)}
                          value={codexMicroActionValue(option.action)}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                  <SelectItem hideIndicator value={TEXT_CHOICE}>
                    {TEXT_CHOICE_LABEL}
                  </SelectItem>
                </SelectPopup>
              </Select>
            </div>
            {choice === TEXT_CHOICE ? (
              <div className="space-y-1.5">
                <Input
                  value={text}
                  maxLength={MAX_TEXT_LENGTH}
                  aria-label="Text to insert"
                  aria-describedby="codex-micro-insert-text-hint"
                  placeholder="Text to insert"
                  onChange={(event) => setText(event.currentTarget.value)}
                />
                <p id="codex-micro-insert-text-hint" className="text-xs text-muted-foreground">
                  Adds custom text to the active prompt without sending it
                </p>
              </div>
            ) : null}
            {effectiveAction?.type === "push-to-talk" ? (
              <p className="text-xs text-muted-foreground">
                Dictation isn't available on desktop yet
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={action === null} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
