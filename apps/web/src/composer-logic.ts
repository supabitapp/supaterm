import type { ClientSettings } from "@supaterm/contracts/settings";
import type {
  AssistantCitation,
  EnvironmentId,
  ResolvedKeybindingsConfig,
} from "@supaterm/contracts";
import type { ComposerPathSearchTarget } from "@supaterm/client-runtime/state/threads";
import {
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@supaterm/shared/assistantCitations";
import { detectComposerTrigger, type ComposerTrigger } from "@supaterm/shared/composerTrigger";
import {
  splitPromptIntoComposerSegments,
  type ComposerPromptSegment,
} from "./composer-editor-mentions";

import {
  formatShortcutLabel,
  resolveShortcutCommand,
  shortcutLabelForCommand,
  type ShortcutEventLike,
} from "./keybindings";
import { isMacPlatform } from "./lib/utils";

export type ComposerSubmissionIntent = "foreground" | "background" | "alternate";

export function isPathSuggestionCurrent(
  searchTarget: ComposerPathSearchTarget,
  trigger: ComposerTrigger | null,
  environmentId: EnvironmentId | null,
  cwd: string | null,
) {
  return (
    trigger?.kind === "path" &&
    searchTarget.environmentId === environmentId &&
    searchTarget.cwd === cwd &&
    searchTarget.query === trigger.query.trim()
  );
}

export function formatAssistantCitationForComposer(citation: AssistantCitation, comment = "") {
  return `${serializeAssistantCitation(withAssistantCitationComment(citation, comment))} `;
}

export function composerRequiresModifier(
  sendShortcut: ClientSettings["sendShortcut"] | undefined,
  prompt: string,
) {
  return (
    sendShortcut === "mod-enter" ||
    (sendShortcut === "mod-enter-multiline" && /[\r\n]/.test(prompt))
  );
}

export function composerSubmissionIntentForKey(input: {
  event: ShortcutEventLike & { isComposing?: boolean; keyCode?: number; repeat?: boolean };
  keybindings: ResolvedKeybindingsConfig;
  platform?: string;
  isSoftwareKeyboardOpen: boolean;
  isDraftThread: boolean;
  isRunning?: boolean;
  sendShortcut?: ClientSettings["sendShortcut"];
  prompt?: string;
}): ComposerSubmissionIntent | null {
  const { event } = input;
  if (event.isComposing || event.keyCode === 229 || event.repeat) return null;
  if (input.isSoftwareKeyboardOpen && event.key === "Enter" && !event.metaKey && !event.ctrlKey)
    return null;
  const command = resolveShortcutCommand(event, input.keybindings, {
    ...(input.platform === undefined ? {} : { platform: input.platform }),
    context: {
      composerFocus: true,
      draftThreadRoute: input.isDraftThread,
      turnRunning: input.isRunning === true,
      composerRequiresModifier: composerRequiresModifier(input.sendShortcut, input.prompt ?? ""),
    },
  });
  if (command === "composer.sendAlternate" && input.isRunning) return "alternate";
  if (command === "composer.sendBackground" && input.isDraftThread) return "background";
  if (command === "composer.sendAndNewThread" && !input.isDraftThread) return "background";
  if (command !== null || event.key !== "Enter" || event.shiftKey || event.altKey) return null;
  if (
    composerRequiresModifier(input.sendShortcut, input.prompt ?? "") &&
    !event.metaKey &&
    !event.ctrlKey
  )
    return null;
  return "foreground";
}

export type ComposerSendAction = ComposerSubmissionIntent | "newLine";

const COMPOSER_ENTER_KEYS = [
  { shiftKey: false, modKey: false },
  { shiftKey: true, modKey: false },
  { shiftKey: false, modKey: true },
] as const;

/**
 * The first key that runs each composer send action, resolved the way the composer's keydown
 * handler resolves Enter and the send keybindings. Actions without a key are absent.
 */
export function composerSendShortcutLabels(input: {
  keybindings: ResolvedKeybindingsConfig;
  platform: string;
  isDraftThread: boolean;
  isRunning: boolean;
  sendShortcut: ClientSettings["sendShortcut"];
  hasMultilinePrompt: boolean;
  isSoftwareKeyboardOpen: boolean;
}): Partial<Record<ComposerSendAction, string>> {
  const { keybindings, platform, isDraftThread, isRunning } = input;
  const labels: Partial<Record<ComposerSendAction, string>> = {};
  const useMetaForMod = isMacPlatform(platform);
  for (const { shiftKey, modKey } of COMPOSER_ENTER_KEYS) {
    const intent = composerSubmissionIntentForKey({
      event: {
        key: "Enter",
        metaKey: modKey && useMetaForMod,
        ctrlKey: modKey && !useMetaForMod,
        shiftKey,
        altKey: false,
      },
      keybindings,
      platform,
      isSoftwareKeyboardOpen: input.isSoftwareKeyboardOpen,
      isDraftThread,
      isRunning,
      sendShortcut: input.sendShortcut,
      prompt: input.hasMultilinePrompt ? "\n" : "",
    });
    // An unmodified Enter the composer does not submit falls through to the editor as a line break.
    const action = intent ?? (modKey ? null : "newLine");
    if (action === null || labels[action] !== undefined) continue;
    labels[action] = formatShortcutLabel(
      { key: "enter", metaKey: false, ctrlKey: false, altKey: false, shiftKey, modKey },
      platform,
    );
  }
  const options = {
    platform,
    context: {
      composerFocus: true,
      draftThreadRoute: isDraftThread,
      turnRunning: isRunning,
      composerRequiresModifier: composerRequiresModifier(
        input.sendShortcut,
        input.hasMultilinePrompt ? "\n" : "",
      ),
    },
  };
  const alternate = isRunning
    ? shortcutLabelForCommand(keybindings, "composer.sendAlternate", options)
    : null;
  const background = shortcutLabelForCommand(
    keybindings,
    isDraftThread ? "composer.sendBackground" : "composer.sendAndNewThread",
    options,
  );
  if (alternate && labels.alternate === undefined) labels.alternate = alternate;
  if (background && labels.background === undefined) labels.background = background;
  return labels;
}

const isInlineTokenSegment = (segment: ComposerPromptSegment): boolean => segment.type !== "text";

function clampCursor(text: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return text.length;
  return Math.max(0, Math.min(text.length, Math.floor(cursor)));
}

export function expandCollapsedComposerCursor(
  text: string,
  cursorInput: number,
  literalText = false,
): number {
  if (literalText) return clampCursor(text, cursorInput);
  const collapsedCursor = clampCursor(text, cursorInput);
  const segments = splitPromptIntoComposerSegments(text);
  if (segments.length === 0) {
    return collapsedCursor;
  }

  let remaining = collapsedCursor;
  let expandedCursor = 0;

  for (const segment of segments) {
    if (
      segment.type === "mention" ||
      segment.type === "citation" ||
      segment.type === "context-reference"
    ) {
      const expandedLength = segment.source.length;
      if (remaining <= 1) {
        return expandedCursor + (remaining === 0 ? 0 : expandedLength);
      }
      remaining -= 1;
      expandedCursor += expandedLength;
      continue;
    }
    if (segment.type === "skill") {
      const expandedLength = segment.source.length;
      if (remaining <= 1) {
        return expandedCursor + (remaining === 0 ? 0 : expandedLength);
      }
      remaining -= 1;
      expandedCursor += expandedLength;
      continue;
    }

    const segmentLength = segment.text.length;
    if (remaining <= segmentLength) {
      return expandedCursor + remaining;
    }
    remaining -= segmentLength;
    expandedCursor += segmentLength;
  }

  return expandedCursor;
}

function collapsedSegmentLength(segment: ComposerPromptSegment): number {
  if (segment.type === "text") {
    return segment.text.length;
  }
  return 1;
}

function clampCollapsedComposerCursorForSegments(
  segments: ReadonlyArray<ComposerPromptSegment>,
  cursorInput: number,
): number {
  const collapsedLength = segments.reduce(
    (total, segment) => total + collapsedSegmentLength(segment),
    0,
  );
  if (!Number.isFinite(cursorInput)) {
    return collapsedLength;
  }
  return Math.max(0, Math.min(collapsedLength, Math.floor(cursorInput)));
}

export function clampCollapsedComposerCursor(
  text: string,
  cursorInput: number,
  literalText = false,
): number {
  if (literalText) return clampCursor(text, cursorInput);
  return clampCollapsedComposerCursorForSegments(
    splitPromptIntoComposerSegments(text),
    cursorInput,
  );
}

export function collapseExpandedComposerCursor(
  text: string,
  cursorInput: number,
  literalText = false,
): number {
  if (literalText) return clampCursor(text, cursorInput);
  const expandedCursor = clampCursor(text, cursorInput);
  const segments = splitPromptIntoComposerSegments(text);
  if (segments.length === 0) {
    return expandedCursor;
  }

  let remaining = expandedCursor;
  let collapsedCursor = 0;

  for (const segment of segments) {
    if (
      segment.type === "mention" ||
      segment.type === "citation" ||
      segment.type === "context-reference"
    ) {
      const expandedLength = segment.source.length;
      if (remaining === 0) {
        return collapsedCursor;
      }
      if (remaining <= expandedLength) {
        return collapsedCursor + 1;
      }
      remaining -= expandedLength;
      collapsedCursor += 1;
      continue;
    }
    if (segment.type === "skill") {
      const expandedLength = segment.source.length;
      if (remaining === 0) {
        return collapsedCursor;
      }
      if (remaining <= expandedLength) {
        return collapsedCursor + 1;
      }
      remaining -= expandedLength;
      collapsedCursor += 1;
      continue;
    }

    const segmentLength = segment.text.length;
    if (remaining <= segmentLength) {
      return collapsedCursor + remaining;
    }
    remaining -= segmentLength;
    collapsedCursor += segmentLength;
  }

  return collapsedCursor;
}

export function isCollapsedCursorAdjacentToInlineToken(
  text: string,
  cursorInput: number,
  direction: "left" | "right",
): boolean {
  const segments = splitPromptIntoComposerSegments(text);
  if (!segments.some(isInlineTokenSegment)) {
    return false;
  }

  const cursor = clampCollapsedComposerCursorForSegments(segments, cursorInput);
  let collapsedOffset = 0;

  for (const segment of segments) {
    if (isInlineTokenSegment(segment)) {
      if (direction === "left" && cursor === collapsedOffset + 1) {
        return true;
      }
      if (direction === "right" && cursor === collapsedOffset) {
        return true;
      }
    }
    collapsedOffset += collapsedSegmentLength(segment);
  }

  return false;
}

export function pastedPathQueryLength(
  lineBefore: string,
  pasted: string,
  pathQueryActive = true,
): number {
  if (!pathQueryActive) return 0;
  if (detectComposerTrigger(lineBefore, lineBefore.length)?.kind !== "path") return 0;
  return /^\S*/.exec(pasted)![0].length;
}

export function composerStateAtPromptEnd(
  text: string,
  literalText = false,
): {
  cursor: number;
  trigger: ComposerTrigger | null;
} {
  const cursor = collapseExpandedComposerCursor(text, text.length, literalText);
  return {
    cursor,
    trigger: literalText
      ? null
      : detectComposerTrigger(text, expandCollapsedComposerCursor(text, cursor)),
  };
}
