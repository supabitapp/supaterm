import {
  connectionStatusText,
  type EnvironmentConnectionPresentation,
} from "@supaterm/client-runtime/connection";

import { m, type MessageResolver } from "../../i18n/messages";

export function environmentStatusText(
  connection: EnvironmentConnectionPresentation,
  resolve: MessageResolver = m,
): string {
  return connection.phase === "unsupported" && connection.error !== null
    ? connection.error
    : connectionStatusText(connection, resolve);
}
