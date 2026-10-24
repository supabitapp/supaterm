import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { PushChallenge } from "./pushRegistrar";

const Identifier = Schema.String.check(Schema.isMaxLength(256));

const PushRoute = Schema.Struct({
  environmentId: Identifier.check(Schema.isMinLength(1)),
  threadId: Identifier,
});
export type PushRoute = typeof PushRoute.Type;

const ChallengePayload = Schema.Struct({
  supatermChallenge: Schema.Struct({
    enrollmentId: Identifier.check(Schema.isMinLength(1)),
    code: Identifier.check(Schema.isMinLength(1)),
  }),
});

const decodeRoute = Schema.decodeUnknownOption(PushRoute);
const decodeChallenge = Schema.decodeUnknownOption(ChallengePayload);

/** The notification service extension writes the route to `userInfo.body`, which Expo exposes as `content.data`. */
export function pushRouteFromData(data: unknown): PushRoute | null {
  return Option.getOrNull(decodeRoute(data));
}

/** Challenge pushes keep `supatermChallenge` at the top of the APNs payload, which Expo exposes as `trigger.payload`. */
export function pushChallengeFromPayload(payload: unknown): PushChallenge | null {
  return Option.getOrNull(Option.map(decodeChallenge(payload), (value) => value.supatermChallenge));
}

export function pushRouteHref(route: PushRoute): string {
  return route.threadId === ""
    ? "/"
    : `/threads/${encodeURIComponent(route.environmentId)}/${encodeURIComponent(route.threadId)}`;
}
