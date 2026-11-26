import {
  AuthDiagnosticsReadScope,
  sessionGrantsScope,
  type SessionGrantInput,
} from "@supaterm/contracts";

import type { EnvironmentConnectionPhase } from "../connection/presentation.ts";
import { msg } from "gt-i18n";

export function resolveUsageAccess(input: {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly session: SessionGrantInput | null;
  readonly hasSessionError: boolean;
}) {
  if (input.hasSessionError) {
    return {
      canReadDiagnostics: false,
      isPending: false,
      error: msg("Could not check this connection's access to diagnostics and usage."),
    };
  }
  if (input.session === null) {
    // An unprepared offline connection cannot finish its session check. Keep
    // it out of pending totals until the connection starts another attempt.
    const isPending =
      input.connectionPhase === "connected" ||
      input.connectionPhase === "connecting" ||
      input.connectionPhase === "reconnecting";
    return {
      canReadDiagnostics: false,
      isPending,
      error: isPending ? null : msg("This environment is not connected."),
    };
  }
  const canReadDiagnostics = sessionGrantsScope(input.session, AuthDiagnosticsReadScope);
  return {
    canReadDiagnostics,
    isPending: false,
    error: canReadDiagnostics
      ? null
      : msg("This connection does not have access to diagnostics and usage."),
  };
}
