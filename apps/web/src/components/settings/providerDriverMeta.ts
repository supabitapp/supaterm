import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
} from "@supaterm/contracts";
import { acpRegistryClient } from "@supaterm/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@supaterm/provider-core/client";
import { cursorClient } from "@supaterm/provider-cursor/client";
import { grokClient } from "@supaterm/provider-grok/client";
import { museClient } from "@supaterm/provider-muse/client";
import { openCodeClient } from "@supaterm/provider-opencode/client";
import { piClient } from "@supaterm/provider-pi/client";

export const providerClients = makeProviderClientRegistry([
  {
    driverKind: ProviderDriverKind.make("codex"),
    label: "Codex",
    settingsSchema: CodexSettings,
  },
  {
    driverKind: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    settingsSchema: ClaudeSettings,
  },
  cursorClient,
  grokClient,
  openCodeClient,
  {
    driverKind: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    settingsSchema: AntigravitySettings,
  },
  museClient,
  piClient,
  acpRegistryClient,
]);
