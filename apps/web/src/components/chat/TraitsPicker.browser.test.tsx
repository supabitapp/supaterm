import { ProviderDriverKind, type ProviderOptionDescriptor } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { TraitsPicker } from "./TraitsPicker";

const effort: ProviderOptionDescriptor = {
  id: "reasoningEffort",
  label: "Reasoning effort",
  type: "select",
  options: [{ id: "high", label: "High", isDefault: true }],
};

it.each([
  {
    secondary: {
      id: "contextWindow",
      label: "Context window",
      type: "select" as const,
      options: [{ id: "1m", label: "1M", isDefault: true }],
    },
    expected: "High · 1M",
  },
  {
    secondary: {
      id: "thinking",
      label: "Thinking",
      type: "boolean" as const,
      currentValue: true,
    },
    expected: "High · Thinking On",
  },
])("renders each trait once in the trigger: $expected", async ({ secondary, expected }) => {
  await using screen = await render(
    <TraitsPicker
      provider={ProviderDriverKind.make("codex")}
      model="test-model"
      models={[
        {
          slug: "test-model",
          name: "Test model",
          isCustom: false,
          capabilities: { optionDescriptors: [effort, secondary] },
        },
      ]}
      promptUltrathink="none"
      modelOptions={undefined}
      onModelOptionsChange={vi.fn()}
      isComposerOwned
    />,
  );
  const trigger = screen.getByRole("button");
  await expect.element(trigger).toBeVisible();
  expect(trigger.element().getAttribute("aria-label")).toBe(expected);
  expect(trigger.element().textContent).toBe(expected);
});
