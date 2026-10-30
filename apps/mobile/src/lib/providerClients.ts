import { isProviderDriverKind } from "@supaterm/contracts";
import { acpRegistryClient } from "@supaterm/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@supaterm/provider-core/client";
import { cursorClient } from "@supaterm/provider-cursor/client";
import { grokClient } from "@supaterm/provider-grok/client";
import { museClient } from "@supaterm/provider-muse/client";
import { openCodeClient } from "@supaterm/provider-opencode/client";
import { piClient } from "@supaterm/provider-pi/client";

const providerClients = makeProviderClientRegistry([
  cursorClient,
  grokClient,
  museClient,
  openCodeClient,
  piClient,
  acpRegistryClient,
]);

export function getProviderClient(driver: string | null | undefined) {
  return isProviderDriverKind(driver) ? providerClients.get(driver) : undefined;
}
