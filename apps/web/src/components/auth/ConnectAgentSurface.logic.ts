import {
  type AuthMcpApprovalDecision,
  type AuthMcpApprovalDetails,
  type AuthMcpClientAccess,
  isRuntimeModeAbove,
  parseMcpApprovalCode,
} from "@supaterm/contracts";
import { managedRuntimeModeCeilingMessage } from "@supaterm/client-runtime/contract-labels";

import { m, type MessageResolver } from "~/i18n/messages";

/** Why a managed policy keeps `access` from being granted, or undefined when it may be. */
export function accessCeilingReason(
  details: Pick<AuthMcpApprovalDetails, "runtimeModeCeiling">,
  access: AuthMcpClientAccess,
  resolve: MessageResolver = m,
): string | undefined {
  const ceiling = details.runtimeModeCeiling;
  return ceiling === undefined ||
    access === "read-only" ||
    !isRuntimeModeAbove(access, ceiling.maxRuntimeMode)
    ? undefined
    : managedRuntimeModeCeilingMessage(ceiling.organization, ceiling.maxRuntimeMode, resolve);
}

/**
 * What Approve sends. A typed code is always checked as a code, even when the browser's
 * session could approve, and a level-bound code sends its own level. Null: nothing to send.
 */
export function resolveApprovalDecision(input: {
  readonly code: string;
  readonly access: AuthMcpClientAccess;
  readonly details: AuthMcpApprovalDetails;
}): Exclude<AuthMcpApprovalDecision, { readonly _tag: "deny" }> | null {
  const code = input.code.trim();
  if (code.length > 0) {
    return {
      _tag: "pairing-code",
      access: parseMcpApprovalCode(code)?.access ?? input.access,
      code,
    };
  }
  const { csrfToken, oneClickAccess } = input.details;
  return csrfToken !== undefined && (oneClickAccess ?? []).includes(input.access)
    ? { _tag: "browser-session", access: input.access, csrfToken }
    : null;
}
