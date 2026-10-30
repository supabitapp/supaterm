import { describe, expect, it } from "vite-plus/test";
import { Atom, AtomRegistry } from "effect/reactivity";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@supaterm/contracts";
import type { EnvironmentThread } from "@supaterm/client-runtime/state/models";
import {
  v2Projection,
  v2Now,
} from "../../../../packages/client-runtime/src/state/orchestrationV2TestFixtures";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { createAcknowledgedThreadMessageEchoesAtom } from "./acknowledged-thread-message-echoes";

const message: QueuedThreadMessage = {
  environmentId: EnvironmentId.make("background-environment"),
  threadId: ThreadId.make("background-thread"),
  messageId: MessageId.make("background-image"),
  commandId: CommandId.make("background-command"),
  text: "look at this",
  attachments: [],
  createdAt: "2026-10-04T19:00:00.000Z",
};

function echoedThread(environmentId = message.environmentId): EnvironmentThread {
  return {
    environmentId,
    projection: {
      ...v2Projection,
      messages: [
        {
          id: message.messageId,
          role: "user",
          text: message.text,
          attachments: [],
          createdAt: v2Now,
          updatedAt: v2Now,
          runId: null,
          streaming: false,
          threadId: message.threadId,
          nodeId: null,
          createdBy: "user",
          creationSource: "mobile",
        },
      ],
    },
  };
}

describe("acknowledged message echoes", () => {
  it("observes background delivery without depending on thread selection", () => {
    const registry = AtomRegistry.make();
    const messagesAtom = Atom.make<ReadonlyArray<QueuedThreadMessage>>([message]);
    const source = Atom.make<EnvironmentThread | null>(null);
    const echoes = createAcknowledgedThreadMessageEchoesAtom({
      messagesAtom,
      threadAtom: () => source,
    });
    const unsubscribe = registry.subscribe(echoes, () => {});
    try {
      expect(registry.get(echoes)).toEqual([]);
      registry.set(source, echoedThread());
      expect(registry.get(echoes)).toEqual([message]);
      registry.set(messagesAtom, []);
      expect(registry.get(echoes)).toEqual([]);
      registry.set(source, null);
      expect(registry.get(echoes)).toEqual([]);
    } finally {
      unsubscribe();
      registry.dispose();
    }
  });

  it("matches each acknowledgment against its own environment", () => {
    const registry = AtomRegistry.make();
    const other = { ...message, environmentId: EnvironmentId.make("other-environment") };
    const messagesAtom = Atom.make<ReadonlyArray<QueuedThreadMessage>>([message, other]);
    const delivered = Atom.make<EnvironmentThread | null>(echoedThread());
    const waiting = Atom.make<EnvironmentThread | null>(null);
    const echoes = createAcknowledgedThreadMessageEchoesAtom({
      messagesAtom,
      threadAtom: (ref) => (ref.environmentId === message.environmentId ? delivered : waiting),
    });
    try {
      expect(registry.get(echoes)).toEqual([message]);
      registry.set(waiting, echoedThread(other.environmentId));
      expect(registry.get(echoes)).toEqual([message, other]);
    } finally {
      registry.dispose();
    }
  });
});
