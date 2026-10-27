import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
} from "@supaterm/contracts";
import { acpRegistryClient } from "@supaterm/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@supaterm/provider-core/client";
import { cursorClient } from "@supaterm/provider-cursor/client";
import { fxClient } from "@supaterm/provider-fx/client";
import { grokClient } from "@supaterm/provider-grok/client";
import { museClient } from "@supaterm/provider-muse/client";
import { openCodeClient } from "@supaterm/provider-opencode/client";
import { piClient } from "@supaterm/provider-pi/client";

export const providerClients = makeProviderClientRegistry([
  {
    driverKind: ProviderDriverKind.make("codex"),
    label: "Codex",
    acpRegistryAgentIds: ["codex-acp"],
    settingsSchema: CodexSettings,
  },
  {
    driverKind: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    acpRegistryAgentIds: ["claude-acp"],
    settingsSchema: ClaudeSettings,
  },
  cursorClient,
  grokClient,
  fxClient,
  openCodeClient,
  {
    driverKind: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    acpRegistryAgentIds: ["antigravity-acp"],
    settingsSchema: AntigravitySettings,
  },
  museClient,
  piClient,
  acpRegistryClient,
]);
