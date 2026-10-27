import type { MenuAction } from "@react-native-menu/menu";
import { StackActions, useNavigation } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import type { RuntimeMode } from "@supaterm/contracts";
import { useRef } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { ControlPill } from "../../components/ui/ControlPill";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { parentThreadIsBelow } from "../../lib/android-workspace-navigation";
import { useQuietThreadShell } from "../../state/entities";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  commandFailureMessage,
  sideChatMergeBackBlockReason,
  sideChatParentAttention,
} from "./side-chat";

export function SideChatBar(props: {
  readonly sideChat: EnvironmentThreadShell;
  readonly canOperate: boolean;
  /** Null until the side chat has a finished turn to merge. */
  readonly onMergeBack: (() => void) | null;
  readonly onUpdateRuntimeMode: (runtimeMode: RuntimeMode) => void;
}) {
  const { sideChat } = props;
  const navigation = useNavigation();
  const parentThreadId = sideChat.lineage.parentThreadId;
  const parent = useQuietThreadShell(
    parentThreadId === null
      ? null
      : { environmentId: sideChat.environmentId, threadId: parentThreadId },
  );
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const setRuntimeMode = useAtomCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const busyRef = useRef(false);
  const target = { environmentId: sideChat.environmentId };
  const parentTitle = parent?.title || "parent thread";
  const parentRoute =
    parent === null
      ? null
      : { environmentId: String(parent.environmentId), threadId: String(parent.id) };
  const attention = sideChatParentAttention(parent);
  const mergeBackBlockReason = sideChatMergeBackBlockReason(parent);
  const editsAllowed = sideChat.runtimeMode !== "approval-required";

  const openParent = () => {
    if (parentRoute === null) return;
    navigation.dispatch((state) =>
      parentThreadIsBelow(state, parentRoute)
        ? StackActions.pop()
        : StackActions.push("Thread", parentRoute),
    );
  };

  const runCommand = async (
    failureTitle: string,
    command: () => Promise<AtomCommandResult<unknown, unknown>>,
  ): Promise<boolean | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    const result = await command();
    busyRef.current = false;
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) {
      Dialog.alert(failureTitle, commandFailureMessage(result.cause, "Try again."));
    }
    return false;
  };

  const toggleEdits = async () => {
    const previous = sideChat.runtimeMode;
    const next: RuntimeMode = editsAllowed ? "approval-required" : "auto-accept-edits";
    const applied = await runCommand(
      editsAllowed ? "Could not require approval" : "Could not allow edits",
      () => {
        props.onUpdateRuntimeMode(next);
        return setRuntimeMode({ ...target, input: { threadId: sideChat.id, runtimeMode: next } });
      },
    );
    if (applied === false) props.onUpdateRuntimeMode(previous);
  };

  const promote = () =>
    runCommand("Could not promote side chat", () =>
      updateMetadata({ ...target, input: { threadId: sideChat.id, sideChat: false } }),
    );

  const discard = () => {
    Dialog.confirm({
      title: "Discard side chat?",
      message: `Its conversation is deleted. Anything already merged back still reaches ${parentTitle}.`,
      confirmText: "Discard",
      destructive: true,
      onConfirm: () => {
        void runCommand("Could not discard side chat", () =>
          deleteThread({ ...target, input: { threadId: sideChat.id } }),
        ).then((discarded) => {
          if (!discarded) return;
          navigation.dispatch((state) =>
            parentRoute === null
              ? StackActions.replace("Home")
              : parentThreadIsBelow(state, parentRoute)
                ? StackActions.pop()
                : StackActions.replace("Thread", parentRoute),
          );
        });
      },
    });
  };

  const actions: MenuAction[] = [
    {
      id: "allow-edits",
      title: "Allow edits",
      subtitle: editsAllowed ? "Edits files without asking" : "Asks before editing files",
      image: "pencil",
      state: editsAllowed ? "on" : "off",
      attributes: { disabled: !props.canOperate },
    },
    {
      id: "merge-back",
      title: "Merge back",
      subtitle:
        mergeBackBlockReason ??
        (props.onMergeBack === null
          ? "Available after this side chat finishes a turn"
          : `Bring the latest answer into ${parentTitle}`),
      image: PullRequestGlyph.merged,
      attributes: {
        disabled: !props.canOperate || mergeBackBlockReason !== null || props.onMergeBack === null,
      },
    },
    {
      id: "promote",
      title: "Promote to thread",
      subtitle: "List it with your other threads",
      image: "arrow.up.circle",
      attributes: { disabled: !props.canOperate },
    },
    {
      id: "discard",
      title: "Discard",
      image: "trash",
      attributes: { destructive: true, disabled: !props.canOperate },
    },
  ];

  const onAction = (id: string) => {
    if (id === "allow-edits") void toggleEdits();
    if (id === "merge-back" && mergeBackBlockReason === null) props.onMergeBack?.();
    if (id === "promote") void promote();
    if (id === "discard") discard();
  };

  return (
    <View className="flex-row items-center gap-2 rounded-[20px] border border-border-subtle bg-card-alt py-1.5 pe-1.5 ps-4">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Side chat of ${parentTitle}${attention ? `. ${attention}` : ""}`}
        accessibilityHint={parentRoute === null ? undefined : "Opens the parent thread"}
        disabled={parentRoute === null}
        onPress={openParent}
        className="min-w-0 flex-1 gap-0.5 py-1 active:opacity-70"
      >
        <View className="min-w-0 flex-row items-center gap-1.5">
          <SymbolView
            name="bubble.left.and.bubble.right"
            size={13}
            tintColorClassName="accent-foreground-muted"
          />
          <Text
            numberOfLines={1}
            className="min-w-0 shrink font-supaterm-bold text-sm text-foreground"
          >
            Side chat of {parentTitle}
          </Text>
        </View>
        <Text
          numberOfLines={1}
          className={
            attention === null
              ? "font-sans text-xs text-foreground-secondary"
              : "font-supaterm-medium text-xs text-warning-foreground"
          }
        >
          {attention ?? (editsAllowed ? "Edits allowed" : "Asks before editing")}
        </Text>
      </Pressable>
      {attention !== null && parentRoute !== null ? (
        <Button label="Open parent" tone="secondary" onPress={openParent} />
      ) : null}
      <Menu
        accessible
        accessibilityLabel="Side chat actions"
        accessibilityRole="button"
        actions={actions}
        onPressAction={({ nativeEvent }) => onAction(nativeEvent.event)}
      >
        <ControlPill icon="ellipsis" accessibilityLabel="Side chat actions" />
      </Menu>
    </View>
  );
}
