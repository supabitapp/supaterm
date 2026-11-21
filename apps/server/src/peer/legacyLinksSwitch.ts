import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as PeerLinks from "./PeerLinks.ts";

/**
 * Older servers held links behind a Linked environments switch. Where it is not on, the links on
 * both sides end once, so upgrading never resumes links paused by leaving it off; the switch is
 * then recorded on. Only local state is touched, so it runs before anything can use a link.
 */
export const pauseLinksLeftOff = Effect.fn("PeerLinks.pauseLinksLeftOff")(
  function* () {
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    if ((yield* serverSettings.getSettings).linkedEnvironmentsEnabled) return;
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const links = yield* PeerLinks.PeerLinks;
    const incoming = (yield* auth.listSessions()).filter(
      (session) =>
        session.subject === EnvironmentAuth.MCP_CLIENT_SUBJECT &&
        session.client.label?.startsWith(PeerLinks.LINK_CLIENT_NAME_PREFIX) === true,
    );
    yield* Effect.forEach(incoming, (session) => auth.revokeSession(session.sessionId), {
      discard: true,
    });
    const forgotten = yield* links.unlinkAll;
    yield* serverSettings.updateSettings({ linkedEnvironmentsEnabled: true });
    if (incoming.length + forgotten > 0) {
      yield* Effect.logInfo("Ended links held while Linked environments was off", {
        revokedIncoming: incoming.length,
        forgottenOutgoing: forgotten,
      });
    }
  },
  Effect.catchCause((cause) =>
    Effect.logWarning("Could not end links held while Linked environments was off", {
      cause: Cause.pretty(cause),
    }),
  ),
);
