import type { CodexMicroActionSlot, CodexMicroLayout } from "@supaterm/contracts";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import {
  codexMicroActionLabel,
  codexMicroKeycap,
  codexMicroVisibleSlots,
  resolveCodexMicroSlotAction,
} from "../../codexMicro/codexMicroCatalog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import {
  codexMicroStatusColor,
  CODEX_MICRO_STATUS_LABELS,
  type CodexMicroAgentKeyView,
  type CodexMicroKeyId,
  type CodexMicroStatusLights,
  type CodexMicroTone,
} from "./CodexMicroSettings.logic";

const KEY_CLASS_NAME =
  "flex h-14 items-center justify-center border outline-none transition-[translate,background-color,box-shadow] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none";
const RESTING_KEY_CLASS_NAME = "shadow-xs/5 hover:bg-accent/60";
const PRESSED_KEY_CLASS_NAME = "translate-y-px bg-accent shadow-none";

const COMMAND_ROW_SLOTS: ReadonlySet<CodexMicroActionSlot> = new Set([
  "ACT06",
  "ACT07",
  "ACT08",
  "ACT09",
]);

const TONE_CLASS_NAMES: Readonly<Record<CodexMicroTone, string>> = {
  muted: "bg-muted-foreground/30",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
};

function KeyboardKey({
  id,
  label,
  hint,
  pressed,
  className,
  onSelect,
  children,
}: {
  id: CodexMicroKeyId;
  label: string;
  hint?: string | undefined;
  pressed: boolean;
  className: string;
  onSelect: (id: CodexMicroKeyId) => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              KEY_CLASS_NAME,
              className,
              pressed ? PRESSED_KEY_CLASS_NAME : RESTING_KEY_CLASS_NAME,
            )}
            onClick={() => onSelect(id)}
          >
            {children}
          </button>
        }
      />
      <TooltipPopup side="top">
        <span className="block">{label}</span>
        {hint ? <span className="block text-muted-foreground">{hint}</span> : null}
      </TooltipPopup>
    </Tooltip>
  );
}

function AgentKey({
  view,
  hint,
  pressed,
  onSelect,
}: {
  view: CodexMicroAgentKeyView;
  hint: string | undefined;
  pressed: boolean;
  onSelect: (id: CodexMicroKeyId) => void;
}) {
  const color = codexMicroStatusColor(view.status);
  const status = view.status === "off" ? null : CODEX_MICRO_STATUS_LABELS[view.status];
  return (
    <KeyboardKey
      id={view.key}
      label={`Agent key ${view.number}${view.label ? `: ${view.label}` : ""}`}
      hint={[status, hint].filter(Boolean).join(" · ") || undefined}
      pressed={pressed}
      className="w-14 rounded-xl border-border/70 bg-background"
      onSelect={onSelect}
    >
      <span
        aria-hidden
        className={cn(
          "size-3 rounded-full",
          color === null && "border border-muted-foreground/40",
          view.status === "idle" && "border border-border",
        )}
        style={color === null ? undefined : { backgroundColor: color }}
      />
    </KeyboardKey>
  );
}

function ActionKey({
  slot,
  layout,
  pressed,
  onSelect,
}: {
  slot: CodexMicroActionSlot;
  layout: CodexMicroLayout;
  pressed: boolean;
  onSelect: (id: CodexMicroKeyId) => void;
}) {
  const keySlot = layout.slots[slot];
  const keycap = codexMicroKeycap(keySlot.keycapId);
  const Icon = keycap.icon;
  return (
    <KeyboardKey
      id={slot}
      label={`${keycap.label} keycap: ${codexMicroActionLabel(resolveCodexMicroSlotAction(keySlot))}`}
      pressed={pressed}
      className={cn(
        "rounded-xl border-border/70 bg-card text-foreground/80",
        slot === "ACT10_ACT11" ? "col-span-2" : "w-14",
      )}
      onSelect={onSelect}
    >
      {Icon ? (
        <Icon aria-hidden className="size-4.5" />
      ) : (
        <span aria-hidden className="font-mono text-3xs">
          {keycap.glyph ?? keycap.label}
        </span>
      )}
    </KeyboardKey>
  );
}

function StatusLights({ lights }: { lights: CodexMicroStatusLights }) {
  return (
    <div role="img" aria-label={lights.label} className="flex size-14 items-center justify-center">
      <span className="flex flex-col gap-1.5">
        <span className={cn("size-1.5 rounded-full", TONE_CLASS_NAMES[lights.connection])} />
        <span className={cn("size-1.5 rounded-full", TONE_CLASS_NAMES[lights.battery])} />
      </span>
    </div>
  );
}

/** A static picture of the keyboard; each control opens its editor. */
export function CodexMicroKeyboard({
  layout,
  agentKeys,
  agentKeyHint,
  knobLabel,
  lights,
  pressedKey,
  onSelect,
}: {
  layout: CodexMicroLayout;
  agentKeys: ReadonlyArray<CodexMicroAgentKeyView>;
  agentKeyHint: string | undefined;
  knobLabel: string;
  lights: CodexMicroStatusLights;
  pressedKey: CodexMicroKeyId | null;
  onSelect: (id: CodexMicroKeyId) => void;
}) {
  const slots = codexMicroVisibleSlots(layout);
  const commandSlots = slots.filter((slot) => COMMAND_ROW_SLOTS.has(slot));
  const bottomSlots = slots.filter((slot) => !COMMAND_ROW_SLOTS.has(slot));
  const agentKey = (view: CodexMicroAgentKeyView) => (
    <AgentKey
      key={view.key}
      view={view}
      hint={agentKeyHint}
      pressed={pressedKey === view.key}
      onSelect={onSelect}
    />
  );
  const actionKey = (slot: CodexMicroActionSlot) => (
    <ActionKey
      key={slot}
      slot={slot}
      layout={layout}
      pressed={pressedKey === slot}
      onSelect={onSelect}
    />
  );

  return (
    <div className="grid grid-cols-4 gap-2 rounded-2xl border border-border/60 bg-muted/60 p-2.5 shadow-xs/5">
      <KeyboardKey
        id="knob"
        label={`Knob: ${knobLabel}`}
        pressed={pressedKey === "knob"}
        className="w-14 rounded-full border-border/70 bg-background"
        onSelect={onSelect}
      >
        <span aria-hidden className="size-9 rounded-full border border-border/60" />
      </KeyboardKey>
      {agentKeys.slice(0, 2).map(agentKey)}
      <KeyboardKey
        id="stick"
        label="Analog stick"
        hint="Choose what each direction triggers"
        pressed={pressedKey === "stick"}
        className="w-14 rounded-xl border-border/70 bg-muted"
        onSelect={onSelect}
      >
        <span aria-hidden className="size-8 rounded-full bg-foreground shadow-sm" />
      </KeyboardKey>
      {agentKeys.slice(2).map(agentKey)}
      {commandSlots.map(actionKey)}
      <StatusLights lights={lights} />
      {bottomSlots.map(actionKey)}
    </div>
  );
}
