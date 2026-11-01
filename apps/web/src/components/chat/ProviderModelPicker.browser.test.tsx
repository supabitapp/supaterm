import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@supaterm/contracts";
import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ProviderModelPicker } from "./ProviderModelPicker";

const instanceId = ProviderInstanceId.make("claudeAgent");
const opus = {
  slug: "claude-opus-5-5",
  name: "Claude Opus 5.5",
  shortName: "Opus 5.5",
  isCustom: false,
  capabilities: {},
};
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-01-01T00:00:00.000Z",
  models: [opus],
  slashCommands: [],
  skills: [],
};

it("names the full model for screen readers when the trigger shows its short name", async () => {
  await using screen = await render(
    <ProviderModelPicker
      environmentId={null}
      activeInstanceId={instanceId}
      model={opus.slug}
      lockedProvider={null}
      instanceEntries={deriveProviderInstanceEntries([provider])}
      modelOptionsByInstance={new Map([[instanceId, [opus]]])}
      onInstanceModelChange={() => {}}
    />,
  );

  const trigger = screen.container.querySelector<HTMLElement>("[data-chat-provider-model-picker]");
  await expect.element(trigger).toHaveTextContent("Opus 5.5");
  expect(trigger?.getAttribute("aria-label")).toBe("Claude Opus 5.5");
});
