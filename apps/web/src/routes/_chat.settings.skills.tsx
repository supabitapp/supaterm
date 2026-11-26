import { createFileRoute } from "@tanstack/react-router";
import { SkillsSettingsPanel } from "../components/settings/OrchestrationSkillsSettings";

export const Route = createFileRoute("/_chat/settings/skills")({
  component: SkillsSettingsPanel,
});
