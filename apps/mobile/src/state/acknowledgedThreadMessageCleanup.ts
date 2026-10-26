import {
  acknowledgedThreadMessagesAtom,
  forgetAcknowledgedThreadMessage,
} from "./acknowledged-thread-messages";
import { createAcknowledgedThreadMessageEchoesAtom } from "./acknowledged-thread-message-echoes";
import { appAtomRegistry } from "./atom-registry";
import { environmentThreadDetails } from "./threads";
import { scheduleUnusedComposerAttachmentCleanup } from "./use-composer-drafts";

/** App-lifetime: forgets acknowledged messages once their thread echoes them back. */
export function startAcknowledgedThreadMessageCleanup(): () => void {
  const echoesAtom = createAcknowledgedThreadMessageEchoesAtom({
    messagesAtom: acknowledgedThreadMessagesAtom,
    threadAtom: environmentThreadDetails.threadAtom,
  });
  return appAtomRegistry.subscribe(
    echoesAtom,
    (echoedMessages) => {
      for (const message of echoedMessages) {
        forgetAcknowledgedThreadMessage(message);
      }
      scheduleUnusedComposerAttachmentCleanup(
        echoedMessages.flatMap((message) => message.attachments),
      );
    },
    { immediate: true },
  );
}
