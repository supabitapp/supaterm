import {
  applyCommandOutputFrame,
  EMPTY_COMMAND_OUTPUT,
} from "@supaterm/client-runtime/state/command-output";
import {
  GUEST_COMMAND_OUTPUT_ROUTE,
  GUEST_ITEM_ROUTE,
  GUEST_SHARE_PARAM,
  OrchestrationV2CommandOutputFrame,
  OrchestrationV2GetTurnItemResult,
  type OrchestrationV2GetTurnItemInput,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";

import type { GuestTransport } from "./guestTransport";
import { openGuestEvents } from "./guestEvents";
import type { TurnItemSource } from "../chat/timelineRowContext";

class GuestItemReadError extends Data.TaggedError("GuestItemReadError")<{
  readonly message: string;
}> {}

const decodeDetail = Schema.decodeUnknownSync(Schema.toCodecJson(OrchestrationV2GetTurnItemResult));
const decodeFrame = Schema.decodeUnknownOption(
  Schema.fromJsonString(OrchestrationV2CommandOutputFrame),
);

const itemUrl = (route: string, shareId: string, itemId: string) =>
  `${route}?${GUEST_SHARE_PARAM}=${encodeURIComponent(shareId)}&item=${encodeURIComponent(itemId)}`;

async function fetchGuestItemDetail(
  transport: GuestTransport,
  shareId: string,
  itemId: string,
): Promise<OrchestrationV2GetTurnItemResult> {
  const response = await transport.request(itemUrl(GUEST_ITEM_ROUTE, shareId, itemId));
  if (response.status === 403) return { item: null };
  if (!response.ok) throw new Error(`Guest item request failed with ${response.status}.`);
  return decodeDetail(await response.json());
}
export const guestTurnItemSource = (shareId: string, transport: GuestTransport): TurnItemSource => {
  const detail = Atom.family((key: string) => {
    const [itemId] = JSON.parse(key) as [string, string | undefined];
    return Atom.make(
      Effect.tryPromise({
        try: () => fetchGuestItemDetail(transport, shareId, itemId),
        catch: () => new GuestItemReadError({ message: "Could not load this item." }),
      }),
    );
  });
  const commandOutput = Atom.family((itemId: string) => {
    const frames = Stream.callback<OrchestrationV2CommandOutputFrame, GuestItemReadError>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const source = openGuestEvents(
            transport,
            itemUrl(GUEST_COMMAND_OUTPUT_ROUTE, shareId, itemId),
            (data) => {
              const frame = decodeFrame(data);
              if (Option.isNone(frame)) return;
              Queue.offerUnsafe(queue, frame.value);
              if (!frame.value.running) {
                source.close();
                Queue.endUnsafe(queue);
              }
            },
            (reason) =>
              Queue.failCauseUnsafe(
                queue,
                Cause.fail(
                  new GuestItemReadError({
                    message:
                      reason === "event_too_large"
                        ? "This output is too large to share."
                        : "Output is no longer available.",
                  }),
                ),
              ),
          );
          return source;
        }),
        (source) => Effect.sync(() => source.close()),
      ),
    );
    return Atom.make(
      frames.pipe(
        Stream.scan(() => EMPTY_COMMAND_OUTPUT, applyCommandOutputFrame),
        Stream.filter((view) => view !== EMPTY_COMMAND_OUTPUT),
      ),
    );
  });
  return {
    detail: ({ itemId, revision }: OrchestrationV2GetTurnItemInput) =>
      detail(JSON.stringify([itemId, revision])),
    commandOutput: ({ itemId }) => commandOutput(itemId),
  };
};
