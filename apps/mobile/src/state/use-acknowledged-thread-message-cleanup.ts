import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo } from "react";
import {
  acknowledgedThreadMessagesAtom,
  forgetAcknowledgedThreadMessage,
} from "./acknowledged-thread-messages";
import { createAcknowledgedThreadMessageEchoesAtom } from "./acknowledged-thread-message-echoes";
import { environmentThreadDetails } from "./threads";
import { scheduleUnusedComposerAttachmentCleanup } from "./use-composer-drafts";

export function useAcknowledgedThreadMessageCleanup() {
  const echoesAtom = useMemo(
    () =>
      createAcknowledgedThreadMessageEchoesAtom({
        messagesAtom: acknowledgedThreadMessagesAtom,
        threadAtom: environmentThreadDetails.threadAtom,
      }),
    [],
  );
  const echoedMessages = useAtomValue(echoesAtom);
  useEffect(() => {
    for (const message of echoedMessages) {
      forgetAcknowledgedThreadMessage(message);
    }
    scheduleUnusedComposerAttachmentCleanup(
      echoedMessages.flatMap((message) => message.attachments),
    );
  }, [echoedMessages]);
}
