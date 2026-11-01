import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import {
  resolveLatestMergeBackRun,
  sideChatBringBackBlockedReason,
} from "@supaterm/client-runtime/state/thread-workflows";
import { AuthOrchestrationOperateScope, type ThreadId } from "@supaterm/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import * as Dialog from "../../components/ui/Dialog";
import { cn } from "../../lib/cn";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

function ActionChip(props: {
  readonly label: string;
  readonly hint?: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.hint}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn("rounded-full bg-subtle px-2.5 py-1", props.disabled && "opacity-50")}
    >
      <Text
        className={cn("text-xs", props.destructive ? "text-danger-foreground" : "text-foreground")}
        numberOfLines={1}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

/** Bring back, Promote and Delete for a side chat, above its composer. */
export function SideChatActionsRow(props: {
  readonly thread: EnvironmentThreadShell;
  readonly parentThreadId: ThreadId;
}) {
  const { thread, parentThreadId } = props;
  const navigation = useNavigation();
  const parent = useQuietThreadShell(scopeThreadRef(thread.environmentId, parentThreadId));
  const mergeRun = useAtomValue(
    environmentThreadDetails.threadAtom(scopeThreadRef(thread.environmentId, thread.id)),
    (detail) => (detail ? resolveLatestMergeBackRun(detail.projection) : null),
  );
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const mergeBack = useAtomCommand(threadEnvironment.mergeBack, { reportFailure: false });
  const promote = useAtomCommand(threadEnvironment.promoteSideChat, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const bringBackBlockedReason = sideChatBringBackBlockedReason({
    canOperate,
    parentRuntime: parent?.runtime,
    mergeRun,
  });

  const run = async (
    failureTitle: string,
    action: () => Promise<AtomCommandResult<unknown, unknown>>,
    onSuccess?: () => void,
  ) => {
    if (busy) return;
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result._tag === "Success") onSuccess?.();
    else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert(failureTitle, error instanceof Error ? error.message : "Try again in a moment.");
    }
  };

  const bringBack = () => {
    if (bringBackBlockedReason !== null || mergeRun === null) {
      Dialog.alert("Bring back is unavailable", bringBackBlockedReason ?? "");
      return;
    }
    void run(
      "Could not bring back the side chat",
      () =>
        mergeBack({
          environmentId: thread.environmentId,
          input: { sourceThreadId: thread.id, targetThreadId: parentThreadId, runId: mergeRun.id },
        }),
      () =>
        Dialog.alert(
          "Brought back",
          "The main thread gets this side chat with your next message there.",
        ),
    );
  };

  const confirmDelete = () =>
    Dialog.confirm({
      title: "Delete side chat?",
      message: `“${thread.title}” will be permanently deleted.`,
      confirmText: "Delete",
      destructive: true,
      onConfirm: () => {
        void run(
          "Could not delete the side chat",
          () =>
            deleteThread({ environmentId: thread.environmentId, input: { threadId: thread.id } }),
          () => navigation.goBack(),
        );
      },
    });

  return (
    <View className="flex-row items-center gap-2 pb-2 pl-4 pr-4">
      <SymbolView
        name="bubble.left.and.bubble.right"
        size={12}
        tintColorClassName="accent-foreground-muted"
      />
      <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
        Side chat of {parent?.title ?? "its main thread"}
      </Text>
      <ActionChip
        label="Bring back"
        hint="Adds this side chat to the main thread's next message."
        disabled={!canOperate || busy}
        onPress={bringBack}
      />
      <ActionChip
        label="Promote"
        hint="Makes this a full thread that shows in lists and stops asking first."
        disabled={!canOperate || busy}
        onPress={() =>
          void run("Could not promote the side chat", () =>
            promote({ environmentId: thread.environmentId, input: { threadId: thread.id } }),
          )
        }
      />
      <ActionChip
        label="Delete"
        destructive
        disabled={!canOperate || busy}
        onPress={confirmDelete}
      />
    </View>
  );
}
