import { createFileRoute } from "@tanstack/react-router";
import { VoiceSettingsPanel } from "../components/settings/VoiceSettings";

export const Route = createFileRoute("/_chat/settings/voice")({
  component: VoiceSettingsPanel,
});
