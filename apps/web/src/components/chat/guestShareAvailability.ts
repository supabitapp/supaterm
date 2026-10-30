import type { EnvironmentId } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { environmentPresentations } from "~/state/presentation";
import { serverEnvironment } from "~/state/server";

export const canShareWithGuestAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) =>
      get(serverEnvironment.createGuestShare.permissionAtom(environmentId)) &&
      get(environmentPresentations.serverConfigsAtom).get(environmentId)?.settings
        .guestSharingEnabled === true,
  ).pipe(Atom.withLabel(`guest-share:available:${environmentId}`)),
);
