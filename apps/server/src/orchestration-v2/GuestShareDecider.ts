import {
  GUEST_PENDING_ATTACHMENT_BYTES_LIMIT,
  GUEST_PENDING_MESSAGE_LIMIT,
  GUEST_RESOLVED_MESSAGE_LIMIT,
  type GuestMessageAttribution,
  type GuestMessageId,
  type OrchestrationMessageContext,
  type OrchestrationV2AppThread,
  type OrchestrationV2ServerCommand,
  type ThreadGuestMessage,
  type ThreadGuestShare,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

export type GuestShareCommand = Extract<
  OrchestrationV2ServerCommand,
  {
    readonly type:
      | "thread.guest-share.open"
      | "thread.guest-share.redeem"
      | "thread.guest-share.close"
      | "thread.guest-message.submit"
      | "thread.guest-message.dismiss";
  }
>;

export const GUEST_FAILURE = {
  inactive: "This guest link is no longer active.",
  used: "This guest link was already used.",
  busy: "Wait for the owner to answer your earlier messages.",
  filesBusy: "Wait for the owner to answer your earlier messages before you attach more files.",
} as const;

const isExpired = (share: ThreadGuestShare, now: DateTime.Utc) =>
  DateTime.toEpochMillis(now) >= Date.parse(share.expiresAt);

const pendingAttachments = (share: ThreadGuestShare | null) =>
  share?.messages.flatMap((message) =>
    message.status === "pending" ? (message.attachments ?? []) : [],
  ) ?? [];

export function releasedGuestAttachmentIds(
  before: ThreadGuestShare | null,
  after: ThreadGuestShare | null,
): ReadonlyArray<string> {
  const kept = new Set(
    after !== null && after.id === before?.id
      ? after.messages.flatMap((message) =>
          message.status === "dismissed"
            ? []
            : (message.attachments ?? []).map((attachment) => attachment.id),
        )
      : [],
  );
  return pendingAttachments(before)
    .map((attachment) => attachment.id)
    .filter((id) => !kept.has(id));
}

function trimResolved(messages: ReadonlyArray<ThreadGuestMessage>): Array<ThreadGuestMessage> {
  let resolvedBudget = GUEST_RESOLVED_MESSAGE_LIMIT;
  const kept: Array<ThreadGuestMessage> = [];
  for (const message of messages.toReversed()) {
    if (message.status !== "pending") {
      if (resolvedBudget === 0) continue;
      resolvedBudget -= 1;
    }
    kept.push(message);
  }
  return kept.toReversed();
}

const resolveMessage = (
  share: ThreadGuestShare,
  guestMessageId: GuestMessageId,
  status: "sent" | "dismissed",
): Result.Result<ThreadGuestShare, string> => {
  const message = share.messages.find((candidate) => candidate.id === guestMessageId);
  if (message === undefined || message.status !== "pending") {
    return Result.fail(`Guest message ${guestMessageId} is not pending.`);
  }
  return Result.succeed({
    ...share,
    messages: trimResolved(
      share.messages.map((candidate) =>
        candidate.id === guestMessageId ? { ...candidate, status } : candidate,
      ),
    ),
  });
};

export function decideGuestShareCommand(input: {
  readonly thread: OrchestrationV2AppThread;
  readonly command: GuestShareCommand;
  readonly now: DateTime.Utc;
}): Result.Result<OrchestrationV2AppThread, string> {
  const { thread, command, now } = input;
  const share = thread.guestShare ?? null;
  const withShare = (guestShare: ThreadGuestShare | null) =>
    Result.succeed({ ...thread, guestShare, updatedAt: now });

  switch (command.type) {
    case "thread.guest-share.open": {
      if (thread.archivedAt !== null) return Result.fail("Archived threads cannot be shared.");
      return withShare({
        id: command.shareId,
        host: command.host,
        createdAt: DateTime.formatIso(now),
        expiresAt: command.expiresAt,
        guestName: null,
        messages: [],
      });
    }
    case "thread.guest-share.close":
      return share === null ? Result.succeed(thread) : withShare(null);
    case "thread.guest-share.redeem": {
      if (share === null || share.id !== command.shareId || isExpired(share, now)) {
        return Result.fail(GUEST_FAILURE.inactive);
      }
      if (share.guestName !== null) return Result.fail(GUEST_FAILURE.used);
      return withShare({ ...share, guestName: command.guestName });
    }
    case "thread.guest-message.submit": {
      if (
        share === null ||
        share.id !== command.shareId ||
        share.guestName === null ||
        isExpired(share, now)
      ) {
        return Result.fail(GUEST_FAILURE.inactive);
      }
      if (
        share.messages.filter((message) => message.status === "pending").length >=
        GUEST_PENDING_MESSAGE_LIMIT
      ) {
        return Result.fail(GUEST_FAILURE.busy);
      }
      const attachments = command.attachments ?? [];
      const pendingBytes = [...pendingAttachments(share), ...attachments].reduce(
        (total, attachment) => total + attachment.sizeBytes,
        0,
      );
      if (attachments.length > 0 && pendingBytes > GUEST_PENDING_ATTACHMENT_BYTES_LIMIT) {
        return Result.fail(GUEST_FAILURE.filesBusy);
      }
      const guestShare: ThreadGuestShare = {
        ...share,
        messages: trimResolved([
          ...share.messages,
          {
            id: command.guestMessageId,
            text: command.text,
            status: "pending",
            submittedAt: DateTime.formatIso(now),
            ...(attachments.length === 0 ? {} : { attachments }),
          },
        ]),
      };
      return thread.doneOverride === "done"
        ? Result.succeed({
            ...thread,
            guestShare,
            doneOverride: null,
            doneAt: null,
            reopenedAt: now,
            updatedAt: now,
          })
        : withShare(guestShare);
    }
    case "thread.guest-message.dismiss": {
      if (share === null) return Result.fail("This thread has no guest link.");
      return Result.map(resolveMessage(share, command.guestMessageId, "dismissed"), (next) => ({
        ...thread,
        guestShare: next,
        updatedAt: now,
      }));
    }
  }
}

export function decideGuestMessageSend(input: {
  readonly thread: OrchestrationV2AppThread;
  readonly guestMessageId: GuestMessageId;
  readonly now: DateTime.Utc;
}): Result.Result<
  {
    readonly thread: OrchestrationV2AppThread;
    readonly text: string;
    readonly guest: GuestMessageAttribution;
  },
  string
> {
  const share = input.thread.guestShare ?? null;
  if (share === null) return Result.fail("This thread has no guest link.");
  const message = share.messages.find((candidate) => candidate.id === input.guestMessageId);
  const name = share.guestName ?? "Guest";
  const guestText = message?.text ?? "";
  return Result.map(resolveMessage(share, input.guestMessageId, "sent"), (next) => ({
    thread: { ...input.thread, guestShare: next, updatedAt: input.now },
    text: `Message from guest ${name}, sent by the owner:\n\n${guestText}`,
    guest: { guestMessageId: input.guestMessageId, name, text: guestText, shareId: share.id },
  }));
}

export function guestShareAfterCancelledSend(
  thread: OrchestrationV2AppThread,
  guest: Pick<GuestMessageAttribution, "guestMessageId" | "shareId">,
  now: DateTime.Utc,
): OrchestrationV2AppThread {
  const share = thread.guestShare ?? null;
  if (share === null || share.id !== guest.shareId) return thread;
  const message = share.messages.find((candidate) => candidate.id === guest.guestMessageId);
  if (message?.status !== "sent") return thread;
  return {
    ...thread,
    guestShare: {
      ...share,
      messages: share.messages.map((candidate) =>
        candidate.id === guest.guestMessageId ? { ...candidate, status: "dismissed" } : candidate,
      ),
    },
    updatedAt: now,
  };
}

export function withoutGuestAttribution<
  C extends { readonly context?: OrchestrationMessageContext | undefined },
>(command: C): C {
  if (command.context?.guest === undefined) return command;
  const { guest: _guest, ...context } = command.context;
  return { ...command, context };
}
