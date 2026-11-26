import {
  EasDeviceHostConfig,
  type EasDeviceHostConfig as EasDeviceHostConfigType,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { msg } from "gt-react";

import { m, type MessageResolver } from "~/i18n/messages";

export const parseEasDeviceHostDraft = Schema.decodeUnknownOption(EasDeviceHostConfig);

export const newEasDeviceHost = (id: string): EasDeviceHostConfigType => ({
  kind: "eas",
  id,
  label: msg("Expo Simulators"),
  accessToken: "",
  maxSessionMinutes: 30,
  idleMinutes: 10,
  maxConcurrentSessions: 2,
});

/** Adds, replaces, or removes one Expo host. */
export function updateEasDeviceHosts(
  hosts: ReadonlyArray<EasDeviceHostConfigType>,
  host: EasDeviceHostConfigType,
  remove: boolean,
): ReadonlyArray<EasDeviceHostConfigType> {
  if (remove) return hosts.filter((candidate) => candidate.id !== host.id);
  return hosts.some((candidate) => candidate.id === host.id)
    ? hosts.map((candidate) => (candidate.id === host.id ? host : candidate))
    : [...hosts, host];
}

export function easSessionLimits(host: EasDeviceHostConfigType, resolve: MessageResolver = m) {
  return resolve(
    msg(
      "Up to {sessions, plural, one {{sessions} session} other {{sessions} sessions}} at once, each stopped after {maxMinutes} min or {idleMinutes} idle min",
      {
        sessions: host.maxConcurrentSessions,
        maxMinutes: host.maxSessionMinutes,
        idleMinutes: host.idleMinutes,
      },
    ),
  );
}
