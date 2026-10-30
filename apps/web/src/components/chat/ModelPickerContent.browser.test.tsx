import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@supaterm/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { useRef } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import "../../index.css";
import { ModelPickerContent } from "./ModelPickerContent";

const longInstanceId = ProviderInstanceId.make("long-list");
const shortInstanceId = ProviderInstanceId.make("short-list");

function provider(instanceId: ProviderInstanceId, displayName: string, count: number) {
  return {
    instanceId,
    displayName,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-29T00:00:00.000Z",
    models: Array.from({ length: count }, (_, index) => ({
      slug: `${instanceId}-${index}`,
      name: `${displayName} model ${index + 1}`,
      capabilities: {},
      isCustom: false,
    })),
    slashCommands: [],
    skills: [],
  } satisfies ServerProvider;
}

function Picker({
  count,
  activeInstanceId,
}: {
  count: number;
  activeInstanceId: ProviderInstanceId;
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const providers = [
    provider(longInstanceId, "Long list", count),
    provider(shortInstanceId, "Short list", 1),
  ];
  return (
    <div style={{ position: "absolute", bottom: 0 }}>
      <ModelPickerContent
        environmentId={null}
        activeInstanceId={activeInstanceId}
        model={`${activeInstanceId}-0`}
        lockedProvider={null}
        instanceEntries={deriveProviderInstanceEntries(providers)}
        modelOptionsByInstance={new Map(providers.map((entry) => [entry.instanceId, entry.models]))}
        keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
        terminalOpen={false}
        onInstanceModelChange={() => {}}
        searchInputRef={searchInputRef}
      />
    </div>
  );
}

it.each([
  { count: 4, activeInstanceId: longInstanceId },
  { count: 12, activeInstanceId: longInstanceId },
  { count: 4, activeInstanceId: shortInstanceId },
  { count: 12, activeInstanceId: shortInstanceId },
])(
  "keeps the $count-model popup and rail in place from $activeInstanceId",
  async ({ count, activeInstanceId }) => {
    const container = document.createElement("div");
    container.style.cssText = "position:relative;height:500px;width:360px";
    await using screen = await render(
      <Picker count={count} activeInstanceId={activeInstanceId} />,
      { container },
    );
    const picker = screen.container.querySelector<HTMLElement>("[data-model-picker-content]");
    expect(picker).not.toBeNull();
    const longTab = page.getByRole("button", { name: "Long list", exact: true });
    const shortTab = page.getByRole("button", { name: "Short list", exact: true });
    await expect.element(page.getByRole("option").first()).toBeVisible();
    const bounds = picker!.getBoundingClientRect();
    const tabTop = shortTab.element().getBoundingClientRect().top;
    expect(bounds.height).toBeCloseTo(count === 4 ? 249 : 346, 0);

    await userEvent.click(shortTab);
    await expect.element(page.getByRole("option", { name: /^Short list model 1\b/ })).toBeVisible();
    await vi.waitFor(() => {
      expect(picker!.getBoundingClientRect().height).toBeCloseTo(bounds.height, 0);
      expect(shortTab.element().getBoundingClientRect().top).toBeCloseTo(tabTop, 0);
    });

    await userEvent.click(page.getByRole("button", { name: "Favorites", exact: true }));
    await expect.element(page.getByText("No models found", { exact: true })).toBeVisible();
    expect(picker!.getBoundingClientRect().height).toBeCloseTo(bounds.height, 0);

    await userEvent.click(longTab);
    await expect.element(page.getByRole("option", { name: /^Long list model 1\b/ })).toBeVisible();
    expect(picker!.getBoundingClientRect().height).toBeCloseTo(bounds.height, 0);

    const search = page.getByRole("combobox");
    await search.fill("missing model");
    await expect.element(page.getByText("No models found", { exact: true })).toBeVisible();
    expect(picker!.getBoundingClientRect().height).toBeCloseTo(bounds.height, 0);
    await search.fill("");
    await expect.element(page.getByRole("option", { name: /^Long list model 1\b/ })).toBeVisible();
    expect(picker!.getBoundingClientRect().height).toBeCloseTo(bounds.height, 0);
  },
);
