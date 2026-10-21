import { act, render } from "../../../test/render";
import { userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import type { SettingsSearchItem } from "./settingsSearch";

const WIDGET_ITEMS: ReadonlyArray<SettingsSearchItem> = ["One", "Two", "Three", "Four"].map(
  (name) => ({
    id: `widget-${name.toLowerCase()}`,
    title: `Widget ${name}`,
    to: "/settings/general",
  }),
);
const searchItems = vi.hoisted(() => ({
  current: [] as ReadonlyArray<SettingsSearchItem>,
  listeners: new Set<() => void>(),
  set(next: ReadonlyArray<SettingsSearchItem>) {
    searchItems.current = next;
    for (const listener of searchItems.listeners) listener();
  },
}));
vi.mock(import("./useAvailableSettingsSearchItems"), async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    searchItems.listeners.add(listener);
    return () => searchItems.listeners.delete(listener);
  };
  return {
    useAvailableSettingsSearchItems: () =>
      useSyncExternalStore(subscribe, () => searchItems.current),
  };
});
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useLocation: ((options?: { select?: (location: unknown) => unknown }) =>
    options?.select?.({ hash: "", search: {}, pathname: "/settings/general", state: {} }) ??
    "") as never,
  useNavigate: (() => vi.fn()) as never,
}));
vi.mock(import("../sidebar/SidebarChrome"), async (original) => ({
  ...(await original()),
  SidebarUtilityMenu: (() => null) as never,
}));

import { SidebarProvider } from "../ui/sidebar";
import { SettingsSidebarNav } from "./SettingsSidebarNav";

const highlightedResult = () =>
  document.querySelector('[role="option"][aria-selected="true"]')?.textContent;

it("keeps the clamped highlight when results shrink and then return", async () => {
  searchItems.set(WIDGET_ITEMS);
  await using screen = await render(
    <SidebarProvider>
      <SettingsSidebarNav pathname="/settings/general" />
    </SidebarProvider>,
  );
  const { container } = screen;
  const search = container.querySelector<HTMLInputElement>('input[aria-label="Search settings"]');
  expect(search).not.toBeNull();
  await userEvent.fill(search!, "widget");
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
  expect(highlightedResult()).toContain("Widget Four");

  await act(async () => searchItems.set(WIDGET_ITEMS.slice(0, 1)));
  expect(highlightedResult()).toContain("Widget One");

  await act(async () => searchItems.set(WIDGET_ITEMS));
  expect(highlightedResult()).toContain("Widget One");
});
