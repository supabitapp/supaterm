import { EnvironmentId, MessageId, ThreadId } from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/reactivity";

export interface ThreadOutboxMessageIdentity {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
}

export interface ThreadOutboxMessageStorage<Message> {
  readonly load: () => Promise<{
    readonly messages: ReadonlyArray<Message>;
    readonly errors: ReadonlyArray<unknown>;
  }>;
  /** False means another client already removed this message. */
  readonly write: (message: Message) => Promise<void | boolean>;
  readonly remove: (message: Message) => Promise<void>;
  /** Commits a batch atomically before any message is published. */
  readonly writeMany?: (messages: ReadonlyArray<Message>) => Promise<void>;
}

export function groupThreadOutboxMessages<Message extends { readonly createdAt: string }>(
  messages: ReadonlyArray<Message>,
  identify: (message: Message) => ThreadOutboxMessageIdentity,
  compare: (left: Message, right: Message) => number = (left, right) =>
    left.createdAt.localeCompare(right.createdAt),
): Record<string, ReadonlyArray<Message>> {
  const deduplicated = new Map<MessageId, Message>();
  for (const message of messages) deduplicated.set(identify(message).messageId, message);
  const grouped: Record<string, Array<Message>> = {};
  for (const message of deduplicated.values()) {
    const { environmentId, threadId } = identify(message);
    (grouped[`${environmentId}:${threadId}`] ??= []).push(message);
  }
  for (const queue of Object.values(grouped)) queue.sort(compare);
  return grouped;
}

export function flattenThreadOutboxMessages<Message>(
  queues: Record<string, ReadonlyArray<Message>>,
): ReadonlyArray<Message> {
  return Object.values(queues).flat();
}

export class ThreadOutboxManagerError extends Schema.TaggedError<ThreadOutboxManagerError>()(
  "ThreadOutboxManagerError",
  {
    operation: Schema.Literals([
      "load",
      "enqueue",
      "update",
      "remove",
      "clear-environment-load",
      "clear-environment-remove",
    ]),
    environmentId: Schema.NullOr(EnvironmentId),
    threadId: Schema.NullOr(ThreadId),
    messageId: Schema.NullOr(MessageId),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Thread outbox operation ${this.operation} failed for environment ${this.environmentId ?? "unknown"}, thread ${this.threadId ?? "unknown"}, message ${this.messageId ?? "unknown"}.`;
  }
}

export interface ThreadOutboxManagerOptions<Message extends { readonly createdAt: string }> {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly storage: ThreadOutboxMessageStorage<Message>;
  readonly identify: (message: Message) => ThreadOutboxMessageIdentity;
  readonly compare?: (left: Message, right: Message) => number;
  readonly equals?: (left: Message, right: Message) => boolean;
  readonly warn?: (message: string, error: unknown) => void;
}

/** Shared durable queue ownership. Platforms supply their existing message format and storage. */
export function createThreadOutboxManager<Message extends { readonly createdAt: string }>(
  options: ThreadOutboxManagerOptions<Message>,
) {
  const queuedMessagesByThreadKeyAtom = Atom.make<Record<string, ReadonlyArray<Message>>>({}).pipe(
    Atom.keepAlive,
    Atom.withLabel("client:thread-outbox:queued-messages"),
  );
  const identify = options.identify;
  const groupMessages = (messages: ReadonlyArray<Message>) =>
    groupThreadOutboxMessages(messages, identify, options.compare);
  const messagesAtom = Atom.make((get) => {
    const messages = flattenThreadOutboxMessages(get(queuedMessagesByThreadKeyAtom));
    return options.compare ? [...messages].sort(options.compare) : messages;
  }).pipe(Atom.keepAlive);
  const warn =
    options.warn ??
    ((message: string, error: unknown) => {
      Effect.runSync(Effect.logWarning(message, error));
    });
  const failure = (
    operation: ThreadOutboxManagerError["operation"],
    cause: unknown,
    message?: Message,
    environmentId: EnvironmentId | null = null,
  ) =>
    new ThreadOutboxManagerError({
      operation,
      ...(message ? identify(message) : { environmentId, threadId: null, messageId: null }),
      cause,
    });
  let loadPromise: Promise<boolean> | null = null;
  let mutationQueue: Promise<void> = Promise.resolve();
  const revisions = new Map<MessageId, number>();
  const bumpRevision = (messageId: MessageId): void => {
    revisions.set(messageId, (revisions.get(messageId) ?? 0) + 1);
  };

  const serialize = <A>(mutation: () => Promise<A>): Promise<A> => {
    const result = mutationQueue.then(mutation, mutation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const currentMessages = (): ReadonlyArray<Message> => options.registry.get(messagesAtom);

  const setMessages = (messages: ReadonlyArray<Message>): void => {
    options.registry.set(queuedMessagesByThreadKeyAtom, groupMessages(messages));
  };

  const load = (): Promise<boolean> => {
    if (loadPromise !== null) {
      return loadPromise;
    }
    loadPromise = serialize(async () => {
      const result = await options.storage.load();
      const current = currentMessages();
      const currentIds = new Set(current.map((message) => identify(message).messageId));
      const recovered = result.messages.filter(
        (message) =>
          !currentIds.has(identify(message).messageId) &&
          !revisions.has(identify(message).messageId),
      );
      if (recovered.length > 0) setMessages([...recovered, ...current]);
      if (result.errors.length > 0) {
        throw new AggregateError(result.errors, "Some queued messages could not be read.");
      }
      return true;
    }).catch((cause) => {
      loadPromise = null;
      warn("[thread-outbox] failed to load persisted messages", failure("load", cause));
      return false;
    });
    return loadPromise;
  };

  const enqueue = (message: Message): Promise<void> => {
    bumpRevision(identify(message).messageId);
    setMessages([
      ...currentMessages().filter(
        (candidate) => identify(candidate).messageId !== identify(message).messageId,
      ),
      message,
    ]);
    return serialize(async () => {
      try {
        await options.storage.write(message);
      } catch (cause) {
        setMessages(currentMessages().filter((candidate) => candidate !== message));
        if (
          !currentMessages().some(
            (candidate) => identify(candidate).messageId === identify(message).messageId,
          )
        ) {
          try {
            await options.storage.remove(message);
          } catch {}
        }
        throw failure("enqueue", cause, message);
      }
    });
  };

  const enqueueMany = (messages: ReadonlyArray<Message>): Promise<void> =>
    serialize(async () => {
      if (!options.storage.writeMany) {
        throw new Error("This storage adapter does not support atomic outbox batches.");
      }
      try {
        await options.storage.writeMany(messages);
      } catch (cause) {
        throw failure("enqueue", cause);
      }
      for (const message of messages) bumpRevision(identify(message).messageId);
      setMessages([...currentMessages(), ...messages]);
    });

  const reload = (): Promise<void> =>
    serialize(async () => {
      const result = await options.storage.load();
      if (result.errors.length > 0) {
        throw new AggregateError(result.errors, "Some queued messages could not be read.");
      }
      const current = currentMessages();
      const byId = new Map(current.map((message) => [identify(message).messageId, message]));
      const loaded = [...flattenThreadOutboxMessages(groupMessages(result.messages))];
      if (options.compare) loaded.sort(options.compare);
      const reconciled = loaded.map((message) => {
        const previous = byId.get(identify(message).messageId);
        return previous && (previous === message || options.equals?.(previous, message))
          ? previous
          : message;
      });
      if (
        reconciled.length === current.length &&
        reconciled.every((message, index) => message === current[index])
      )
        return;
      const nextIds = new Set(reconciled.map((message) => identify(message).messageId));
      for (const message of current) {
        if (!nextIds.has(identify(message).messageId)) bumpRevision(identify(message).messageId);
      }
      for (const message of reconciled) {
        if (message !== byId.get(identify(message).messageId))
          bumpRevision(identify(message).messageId);
      }
      setMessages(reconciled);
    });

  const confirmQueued = (message: Message): Promise<boolean> =>
    serialize(async () => currentMessages().some((candidate) => candidate === message));

  const update = (
    message: Message,
    expectedRevision?: number,
    canUpdate?: () => boolean,
  ): Promise<boolean> =>
    serialize(async () => {
      const staleOrMissing = (): boolean =>
        !currentMessages().some(
          (candidate) => identify(candidate).messageId === identify(message).messageId,
        ) ||
        canUpdate?.() === false ||
        (expectedRevision !== undefined &&
          (revisions.get(identify(message).messageId) ?? 0) !== expectedRevision);
      if (staleOrMissing()) {
        return false;
      }
      try {
        if ((await options.storage.write(message)) === false) {
          setMessages(
            currentMessages().filter(
              (candidate) => identify(candidate).messageId !== identify(message).messageId,
            ),
          );
          bumpRevision(identify(message).messageId);
          return false;
        }
      } catch (cause) {
        throw failure("update", cause, message);
      }
      if (staleOrMissing()) {
        const winner = currentMessages().find(
          (candidate) => identify(candidate).messageId === identify(message).messageId,
        );
        if (winner !== undefined) {
          try {
            await options.storage.write(winner);
          } catch (cause) {
            throw failure("update", cause, message);
          }
        }
        return false;
      }
      bumpRevision(identify(message).messageId);
      setMessages([
        ...currentMessages().filter(
          (candidate) => identify(candidate).messageId !== identify(message).messageId,
        ),
        message,
      ]);
      return true;
    });

  const amend = (
    messageId: MessageId,
    change: (message: Message) => Message | null,
  ): Promise<boolean> =>
    serialize(async () => {
      const current = currentMessages().find(
        (candidate) => identify(candidate).messageId === messageId,
      );
      if (current === undefined) return false;
      const next = change(current);
      if (next === null) return false;
      const revision = revisions.get(messageId) ?? 0;
      try {
        if ((await options.storage.write(next)) === false) {
          setMessages(
            currentMessages().filter((candidate) => identify(candidate).messageId !== messageId),
          );
          bumpRevision(messageId);
          return false;
        }
      } catch (cause) {
        throw failure("update", cause, next);
      }
      if ((revisions.get(messageId) ?? 0) !== revision || !currentMessages().includes(current)) {
        const winner = currentMessages().find(
          (candidate) => identify(candidate).messageId === messageId,
        );
        if (winner !== undefined) {
          try {
            await options.storage.write(winner);
          } catch (cause) {
            throw failure("update", cause, winner);
          }
        }
        return false;
      }
      setMessages(currentMessages().map((candidate) => (candidate === current ? next : candidate)));
      return true;
    });

  const remove = (
    message: Message,
    expectedRevision?: number,
    canRemove?: () => boolean,
  ): Promise<Message | null> =>
    serialize(async () => {
      const removalCanceled = (): boolean =>
        (expectedRevision !== undefined &&
          (revisions.get(identify(message).messageId) ?? 0) !== expectedRevision) ||
        canRemove?.() === false;
      if (removalCanceled()) {
        return null;
      }
      const removed =
        currentMessages().find(
          (candidate) => identify(candidate).messageId === identify(message).messageId,
        ) ?? message;
      try {
        await options.storage.remove(message);
      } catch (cause) {
        throw failure("remove", cause, message);
      }
      if (removalCanceled()) {
        const winner = currentMessages().find(
          (candidate) => identify(candidate).messageId === identify(message).messageId,
        );
        if (winner !== undefined) {
          try {
            await options.storage.write(winner);
          } catch (cause) {
            throw failure("remove", cause, message);
          }
        }
        return null;
      }
      setMessages(
        currentMessages().filter(
          (candidate) => identify(candidate).messageId !== identify(message).messageId,
        ),
      );
      bumpRevision(identify(message).messageId);
      return removed;
    });

  const clearEnvironment = (environmentId: EnvironmentId): Promise<ReadonlyArray<Message>> => {
    const revisionsAtRequest = new Map(revisions);
    return serialize(async () => {
      const persisted = await options.storage
        .load()
        .then((result) => {
          if (result.errors.length > 0) {
            throw new AggregateError(result.errors, "Some queued messages could not be read.");
          }
          return result.messages;
        })
        .catch((cause) => {
          throw failure("clear-environment-load", cause, undefined, environmentId);
        });
      const allMessages = flattenThreadOutboxMessages(
        groupMessages([...persisted, ...currentMessages()]),
      );
      const candidates = allMessages.filter(
        (message) =>
          identify(message).environmentId === environmentId &&
          (revisions.get(identify(message).messageId) ?? 0) ===
            (revisionsAtRequest.get(identify(message).messageId) ?? 0),
      );
      const candidateRevisions = new Map(
        candidates.map(
          (message) =>
            [identify(message).messageId, revisions.get(identify(message).messageId) ?? 0] as const,
        ),
      );
      const removedFromStorage = new Set<MessageId>();

      await Promise.all(
        candidates.map(async (message) => {
          try {
            await options.storage.remove(message);
            removedFromStorage.add(identify(message).messageId);
          } catch (cause) {
            warn(
              "[thread-outbox] failed to clear persisted message",
              failure("clear-environment-remove", cause, message),
            );
          }
        }),
      );

      await Promise.all(
        candidates.map(async (message) => {
          if (
            !removedFromStorage.has(identify(message).messageId) ||
            (revisions.get(identify(message).messageId) ?? 0) ===
              candidateRevisions.get(identify(message).messageId)
          ) {
            return;
          }
          const retained = currentMessages().find(
            (candidate) => identify(candidate).messageId === identify(message).messageId,
          );
          if (retained === undefined) {
            return;
          }
          try {
            await options.storage.write(retained);
          } catch (cause) {
            warn(
              "[thread-outbox] failed to restore message retained during environment clear",
              failure("clear-environment-remove", cause, retained),
            );
          }
        }),
      );

      const removed = candidates.filter(
        (message) =>
          removedFromStorage.has(identify(message).messageId) &&
          (revisions.get(identify(message).messageId) ?? 0) ===
            candidateRevisions.get(identify(message).messageId),
      );
      const removedMessageIds = new Set(removed.map((message) => identify(message).messageId));
      const reconciledMessages = flattenThreadOutboxMessages(
        groupMessages([...allMessages, ...currentMessages()]),
      ).filter((message) => !removedMessageIds.has(identify(message).messageId));
      for (const message of removed) {
        bumpRevision(identify(message).messageId);
      }
      setMessages(reconciledMessages);
      return removed;
    });
  };

  return {
    queuedMessagesByThreadKeyAtom,
    messagesAtom,
    serialize,
    load,
    reload,
    enqueue,
    enqueueMany,
    getSnapshot: currentMessages,
    subscribe: (listener: () => void) => options.registry.subscribe(messagesAtom, listener),
    confirmQueued,
    revisionOf: (messageId: MessageId): number => revisions.get(messageId) ?? 0,
    update,
    amend,
    remove,
    clearEnvironment,
  };
}

export {
  shouldRetryThreadOutboxDelivery,
  threadOutboxRetryDelayMs,
  resolveThreadOutboxDeliveryAction,
  resolveThreadOutboxDispatchStep,
  resolveThreadOutboxFailureAction,
  type ThreadOutboxCommandStage,
  type ThreadOutboxFailureAction,
} from "./threadOutboxPolicy.ts";
