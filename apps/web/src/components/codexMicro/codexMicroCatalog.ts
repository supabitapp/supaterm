import {
  CODEX_MICRO_ACTION_SLOTS,
  type CodexMicroAction,
  type CodexMicroActionSlot,
  type CodexMicroEncoderInput,
  type CodexMicroKeySlot,
  type CodexMicroKeycapId,
  type CodexMicroLayout,
  type KeybindingCommand,
} from "@supaterm/contracts";
import {
  AiBotIcon,
  AsteriskIcon,
  BrainCircuitIcon,
  BrainIcon,
  BugIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ClockIcon,
  CloudUploadIcon,
  DiffIcon,
  DownloadIcon,
  FlaskIcon,
  FolderPlusIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitForkIcon,
  type IconComponent,
  LayoutGridIcon,
  MicIcon,
  NavigationIcon,
  PaintbrushIcon,
  PartyPopperIcon,
  PlayIcon,
  SlidersHorizontalIcon,
  SquarePenIcon,
  SquareTerminalIcon,
  StarIcon,
  TrashIcon,
  ZapIcon,
} from "@supaterm/icons";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";

export interface CodexMicroKeycap {
  readonly id: CodexMicroKeycapId;
  /** The text printed on the physical keycap. */
  readonly label: string;
  readonly icon: IconComponent | null;
  /** Text keycaps print their text instead of an icon. */
  readonly glyph?: string;
  readonly size: "single" | "double";
  readonly defaultAction: CodexMicroAction | null;
}

const command = (id: KeybindingCommand): CodexMicroAction => ({ type: "command", command: id });

export const CODEX_MICRO_KEYCAPS: ReadonlyArray<CodexMicroKeycap> = [
  {
    id: "FAST",
    label: "FAST",
    icon: ZapIcon,
    size: "single",
    defaultAction: command("composer.toggleFastMode"),
  },
  {
    id: "APPR",
    label: "APPR",
    icon: CircleCheckIcon,
    size: "single",
    defaultAction: command("thread.approve"),
  },
  {
    id: "REJ",
    label: "REJ",
    icon: CircleXIcon,
    size: "single",
    defaultAction: command("thread.decline"),
  },
  {
    id: "SPLIT",
    label: "FORK",
    icon: GitForkIcon,
    size: "single",
    defaultAction: command("thread.fork"),
  },
  {
    id: "MIC1",
    label: "MIC1",
    icon: MicIcon,
    size: "single",
    defaultAction: null,
  },
  {
    id: "CODEX",
    label: "CODEX",
    icon: AiBotIcon,
    size: "single",
    defaultAction: command("composer.submit"),
  },
  { id: "BUG", label: "BUG", icon: BugIcon, size: "single", defaultAction: null },
  { id: "OAI", label: "OAI", icon: AsteriskIcon, size: "single", defaultAction: null },
  {
    id: "TERM",
    label: "TERM",
    icon: SquareTerminalIcon,
    size: "single",
    defaultAction: command("terminal.toggle"),
  },
  { id: "DWN", label: "DWN", icon: DownloadIcon, size: "single", defaultAction: null },
  {
    id: "DEL",
    label: "DEL",
    icon: TrashIcon,
    size: "single",
    defaultAction: command("thread.mark-done"),
  },
  {
    id: "NEW",
    label: "NEW",
    icon: SquarePenIcon,
    size: "single",
    defaultAction: command("chat.new"),
  },
  {
    id: "NAV",
    label: "NAV",
    icon: NavigationIcon,
    size: "single",
    defaultAction: command("preview.toggle"),
  },
  {
    id: "MAGIC",
    label: "MAGIC",
    icon: StarIcon,
    size: "single",
    defaultAction: command("thread.pin"),
  },
  {
    id: "DIFF",
    label: "DIFF",
    icon: DiffIcon,
    size: "single",
    defaultAction: command("diff.toggle"),
  },
  { id: "PLAY", label: "PLAY", icon: PlayIcon, size: "single", defaultAction: null },
  { id: "GIT", label: "GIT", icon: GitCommitIcon, size: "single", defaultAction: null },
  {
    id: "BRCH",
    label: "DRAFT",
    icon: PullRequestGlyph.draft,
    size: "single",
    defaultAction: null,
  },
  { id: "BRANCH", label: "BRANCH", icon: GitBranchIcon, size: "single", defaultAction: null },
  { id: "MRG", label: "MRG", icon: PullRequestGlyph.merged, size: "single", defaultAction: null },
  {
    id: "PR",
    label: "PR",
    icon: PullRequestGlyph.pullRequest,
    size: "single",
    defaultAction: null,
  },
  { id: "PAINT", label: "PAINT", icon: PaintbrushIcon, size: "single", defaultAction: null },
  {
    id: "LAB",
    label: "LAB",
    icon: FlaskIcon,
    size: "single",
    defaultAction: { type: "open-settings" },
  },
  { id: "PARTY", label: "PARTY", icon: PartyPopperIcon, size: "single", defaultAction: null },
  {
    id: "TIME",
    label: "TIME",
    icon: ClockIcon,
    size: "single",
    defaultAction: command("automations.open"),
  },
  {
    id: "MIND+",
    label: "MIND+",
    icon: BrainCircuitIcon,
    size: "single",
    defaultAction: command("composer.increaseEffort"),
  },
  {
    id: "MIND-",
    label: "MIND−",
    icon: BrainIcon,
    size: "single",
    defaultAction: command("composer.decreaseEffort"),
  },
  { id: "EMPT1", label: "EMPT1", icon: CircleDashedIcon, size: "single", defaultAction: null },
  { id: "EMPT2", label: "EMPT2", icon: CircleDashedIcon, size: "single", defaultAction: null },
  { id: "EMPT3", label: "EMPT3", icon: CircleDashedIcon, size: "single", defaultAction: null },
  { id: "EMPT4", label: "EMPT4", icon: CircleDashedIcon, size: "single", defaultAction: null },
  {
    id: "SETUP",
    label: "SETUP",
    icon: SlidersHorizontalIcon,
    size: "single",
    defaultAction: { type: "open-settings" },
  },
  {
    id: "FOLD",
    label: "FOLD",
    icon: FolderPlusIcon,
    size: "single",
    defaultAction: command("projectPicker.toggle"),
  },
  { id: "UPL", label: "UPL", icon: CloudUploadIcon, size: "single", defaultAction: null },
  {
    id: "APPS",
    label: "APPS",
    icon: LayoutGridIcon,
    size: "single",
    defaultAction: command("commandPalette.toggle"),
  },
  {
    id: "YOLO",
    label: "YOLO",
    icon: null,
    glyph: ":yolo:",
    size: "single",
    defaultAction: { type: "composer-text", text: ":yolo:" },
  },
  {
    id: "YEET",
    label: "YEET",
    icon: null,
    glyph: ":yeet:",
    size: "single",
    defaultAction: { type: "composer-text", text: ":yeet:" },
  },
  {
    id: "MIC",
    label: "MIC",
    icon: MicIcon,
    size: "double",
    defaultAction: null,
  },
  { id: "EMPT5", label: "EMPT5", icon: CircleDashedIcon, size: "double", defaultAction: null },
];

const KEYCAPS_BY_ID = new Map(CODEX_MICRO_KEYCAPS.map((keycap) => [keycap.id, keycap]));

export function codexMicroKeycap(id: CodexMicroKeycapId): CodexMicroKeycap {
  return KEYCAPS_BY_ID.get(id) ?? CODEX_MICRO_KEYCAPS[0]!;
}

export function codexMicroKeycapsForSlot(
  slot: CodexMicroActionSlot,
): ReadonlyArray<CodexMicroKeycap> {
  const size = slot === "ACT10_ACT11" ? "double" : "single";
  return CODEX_MICRO_KEYCAPS.filter((keycap) => keycap.size === size);
}

/** The physical keys that are in use: one wide microphone key, or its two switches. */
export function codexMicroVisibleSlots(
  layout: Pick<CodexMicroLayout, "separateMicrophoneKeys">,
): ReadonlyArray<CodexMicroActionSlot> {
  return CODEX_MICRO_ACTION_SLOTS.filter((slot) =>
    layout.separateMicrophoneKeys ? slot !== "ACT10_ACT11" : slot !== "ACT10" && slot !== "ACT11",
  );
}

export function resolveCodexMicroSlotAction(slot: CodexMicroKeySlot): CodexMicroAction | null {
  return slot.action === undefined ? codexMicroKeycap(slot.keycapId).defaultAction : slot.action;
}

const OPEN_CODEX_MICRO_SETTINGS: CodexMicroAction = { type: "open-codex-micro-settings" };

/** What a built-in knob mode does, as the equivalent custom assignments. */
export const CODEX_MICRO_ENCODER_PRESETS = {
  "conversation-scroll": {
    left: command("conversation.scrollUp"),
    right: command("conversation.scrollDown"),
    click: command("conversation.scrollToEnd"),
    longPress: OPEN_CODEX_MICRO_SETTINGS,
  },
  reasoning: {
    left: command("composer.decreaseEffort"),
    right: command("composer.increaseEffort"),
    click: command("composer.effort"),
    longPress: OPEN_CODEX_MICRO_SETTINGS,
  },
} as const satisfies Record<
  Exclude<CodexMicroLayout["encoderMode"], "custom">,
  Record<CodexMicroEncoderInput, CodexMicroAction>
>;

export function resolveCodexMicroEncoderAction(
  layout: Pick<CodexMicroLayout, "encoder" | "encoderMode">,
  input: CodexMicroEncoderInput,
): CodexMicroAction | null {
  return layout.encoderMode === "custom"
    ? layout.encoder[input]
    : CODEX_MICRO_ENCODER_PRESETS[layout.encoderMode][input];
}

/**
 * A keycap exists once per box, so putting one on a key moves it: the key that
 * had it takes the replaced keycap.
 */
export function codexMicroKeycapHolder(
  layout: CodexMicroLayout,
  target: CodexMicroActionSlot,
  keycapId: CodexMicroKeycapId,
): CodexMicroActionSlot | null {
  return (
    codexMicroVisibleSlots(layout).find(
      (slot) => slot !== target && layout.slots[slot].keycapId === keycapId,
    ) ?? null
  );
}

export function assignCodexMicroKeycap(
  layout: CodexMicroLayout,
  target: CodexMicroActionSlot,
  next: CodexMicroKeySlot,
): CodexMicroLayout {
  const holder = codexMicroKeycapHolder(layout, target, next.keycapId);
  const slots = { ...layout.slots, [target]: next };
  if (holder !== null) slots[holder] = { keycapId: layout.slots[target].keycapId };
  return { ...layout, slots };
}

export interface CodexMicroCommandOption {
  readonly action: CodexMicroAction;
  readonly label: string;
}

export interface CodexMicroCommandGroup {
  readonly label: string;
  readonly options: ReadonlyArray<CodexMicroCommandOption>;
}

const option = (id: KeybindingCommand, label: string): CodexMicroCommandOption => ({
  action: command(id),
  label,
});

export const CODEX_MICRO_COMMAND_GROUPS: ReadonlyArray<CodexMicroCommandGroup> = [
  {
    label: "Chat",
    options: [
      option("composer.submit", "Send message"),
      option("composer.toggleFastMode", "Toggle fast mode"),
      option("thread.approve", "Approve"),
      option("thread.decline", "Decline"),
      option("thread.fork", "Fork thread"),
      option("thread.stop", "Stop thread"),
      option("composer.increaseEffort", "Increase reasoning effort"),
      option("composer.decreaseEffort", "Decrease reasoning effort"),
      option("composer.effort", "Choose reasoning effort"),
      option("thread.pin", "Pin or unpin thread"),
      option("thread.mark-done", "Mark thread as Done"),
      option("chat.new", "New thread"),
      option("chat.find", "Find in thread"),
      option("thread.copyReference", "Copy thread link"),
    ],
  },
  {
    label: "Navigation",
    options: [
      option("navigation.back", "Back"),
      option("navigation.forward", "Forward"),
      option("thread.previous", "Previous thread"),
      option("thread.next", "Next thread"),
      option("conversation.scrollUp", "Scroll up the conversation"),
      option("conversation.scrollDown", "Scroll down the conversation"),
      option("conversation.scrollToEnd", "Jump to the latest message"),
    ],
  },
  {
    label: "Panels",
    options: [
      option("sidebar.toggle", "Toggle sidebar"),
      option("rightPanel.toggle", "Toggle right panel"),
      option("diff.toggle", "Toggle diff"),
      option("terminal.toggle", "Toggle terminal"),
      option("preview.toggle", "Toggle browser"),
    ],
  },
  {
    label: "Workspace",
    options: [
      option("projectPicker.toggle", "Choose project"),
      option("filePicker.toggle", "Open file"),
      option("commandPalette.toggle", "Open command palette"),
    ],
  },
  {
    label: "App",
    options: [
      option("automations.open", "Open automations"),
      option("usage.open", "Open usage"),
      option("appearance.cycle", "Cycle appearance"),
      { action: { type: "open-settings" }, label: "Open Settings" },
      { action: OPEN_CODEX_MICRO_SETTINGS, label: "Open Codex Micro settings" },
    ],
  },
];

export function codexMicroActionValue(action: CodexMicroAction): string {
  switch (action.type) {
    case "command":
      return `command:${action.command}`;
    case "composer-text":
      return `text:${action.text}`;
    case "open-settings":
    case "open-codex-micro-settings":
      return action.type;
  }
}

export const CODEX_MICRO_COMMAND_OPTIONS: ReadonlyMap<string, CodexMicroCommandOption> = new Map(
  CODEX_MICRO_COMMAND_GROUPS.flatMap((group) =>
    group.options.map((option) => [codexMicroActionValue(option.action), option] as const),
  ),
);

export function codexMicroActionLabel(action: CodexMicroAction | null): string {
  if (action === null) return "Unassigned";
  switch (action.type) {
    case "command":
      return (
        CODEX_MICRO_COMMAND_OPTIONS.get(codexMicroActionValue(action))?.label ?? action.command
      );
    case "composer-text":
      return `Insert ${action.text}`;
    case "open-settings":
      return "Open Settings";
    case "open-codex-micro-settings":
      return "Open Codex Micro settings";
  }
}
