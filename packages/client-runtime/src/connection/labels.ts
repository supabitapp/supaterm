import * as Option from "effect/Option";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  SshConnectionProfile,
} from "./catalog.ts";
import { BearerConnectionTarget, PrimaryConnectionTarget, SshConnectionTarget } from "./model.ts";
import { connectionRoutes, entryWithRoutes } from "./routes.ts";

export function withEnvironmentLabel(entry: ConnectionCatalogEntry, label: string) {
  return entryWithRoutes(
    entry,
    connectionRoutes(entry).map((route) => {
      const target = route.target;
      return {
        target:
          target._tag === "PrimaryConnectionTarget"
            ? new PrimaryConnectionTarget({ ...target, label })
            : target._tag === "SshConnectionTarget"
              ? new SshConnectionTarget({ ...target, label })
              : new BearerConnectionTarget({ ...target, label }),
        profile: Option.map(route.profile, (profile) =>
          profile._tag === "SshConnectionProfile"
            ? new SshConnectionProfile({ ...profile, label })
            : new BearerConnectionProfile({ ...profile, label }),
        ),
      };
    }),
  );
}
