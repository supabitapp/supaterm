import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import { parseThreadKey, threadKey } from "@supaterm/client-runtime/state/entities";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@supaterm/client-runtime/state/shell";
import { sideChatsOf } from "@supaterm/client-runtime/state/sideChats";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import type { AppBarMenu } from "../../components/ui/AppBar.types";
import { environmentThreadShells } from "../../state/threads";
import { parentSideChats } from "./side-chat";
import { useOpenSideChat } from "./use-open-side-chat";

const EMPTY_SIDE_CHATS: ReadonlyArray<EnvironmentThreadShell> = [];
const EMPTY_SIDE_CHATS_ATOM = Atom.make(EMPTY_SIDE_CHATS).pipe(
  Atom.withLabel("mobile-side-chats:empty"),
);

function sameSummary(left: EnvironmentThreadShell, right: EnvironmentThreadShell | undefined) {
  return (
    left.id === right?.id &&
    left.title === right.title &&
    left.hasPendingApprovals === right.hasPendingApprovals &&
    left.hasPendingUserInput === right.hasPendingUserInput &&
    left.runtime?.status === right.runtime?.status
  );
}

// The parent's screen lists these, so streaming in a side chat must not re-render it.
const sideChatsAtom = Atom.family((key: string) => {
  const parent = parseThreadKey(key);
  let previous = EMPTY_SIDE_CHATS;
  return Atom.make((get) => {
    const shells: EnvironmentThreadShell[] = [];
    for (const thread of sideChatsOf(
      get(environmentThreadShells.environmentThreadsAtom(parent.environmentId)),
      parent.threadId,
    )) {
      const shell = get(
        environmentThreadShells.threadShellAtom({
          environmentId: parent.environmentId,
          threadId: thread.id,
        }),
      );
      if (shell !== null) shells.push(shell);
    }
    const next = parentSideChats(shells, {
      environmentId: parent.environmentId,
      id: parent.threadId,
    });
    if (
      next.length === previous.length &&
      next.every((thread, index) => sameSummary(thread, previous[index]))
    ) {
      return previous;
    }
    previous = next;
    return next;
  }).pipe(Atom.withLabel(`mobile-side-chats:${key}`));
});

function useSideChats(parent: ScopedThreadRef | null): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(parent === null ? EMPTY_SIDE_CHATS_ATOM : sideChatsAtom(threadKey(parent)));
}

function sideChatStatus(sideChat: EnvironmentThreadShell): string | undefined {
  if (sideChat.hasPendingApprovals) return "Needs approval";
  if (sideChat.hasPendingUserInput) return "Needs your answer";
  return threadRuntimeIsActive(sideChat.runtime) ? "Working" : undefined;
}

/** The parent's "Side chats" header menu, shown once it has one. */
export function useSideChatsMenu(input: {
  readonly parent: EnvironmentThreadShell | null;
  readonly offered: boolean;
  readonly canOperate: boolean;
}): AppBarMenu | null {
  const { parent } = input;
  const navigation = useNavigation();
  const openSideChat = useOpenSideChat();
  const sideChats = useSideChats(
    parent === null || !input.offered
      ? null
      : { environmentId: parent.environmentId, threadId: parent.id },
  );
  if (parent === null || sideChats.length === 0) return null;
  const attention = sideChats.some(
    (sideChat) => sideChat.hasPendingApprovals || sideChat.hasPendingUserInput,
  );
  return {
    title: "Side chats",
    icon: "bubble.left.and.bubble.right",
    ...(attention ? { status: "A side chat needs you" } : {}),
    items: [
      ...sideChats.map((sideChat) => ({
        id: `side-chat:${sideChat.id}`,
        title: sideChat.title || "Side chat",
        icon: "bubble.left",
        subtitle: sideChatStatus(sideChat),
        onPress: () =>
          navigation.dispatch(
            StackActions.push("Thread", {
              environmentId: String(sideChat.environmentId),
              threadId: String(sideChat.id),
            }),
          ),
      })),
      {
        id: "side-chat:new",
        title: "New side chat",
        icon: "plus.bubble",
        disabled: !input.canOperate,
        onPress: () => void openSideChat({ parent, fresh: true }),
      },
    ],
  };
}
