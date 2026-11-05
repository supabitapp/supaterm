import { EnvironmentId } from "@supaterm/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

vi.mock("../ProjectFavicon", () => ({ ProjectFavicon: () => null }));

import { render } from "../../../test/render";
import { isMacPlatform } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { isInOpenProjectList } from "../ProjectPinButton";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { SidebarProjectFilterSubmenu } from "./SidebarProjectFilterSubmenu";

const project = (key: string, displayName: string) =>
  ({
    projectKey: key,
    displayName,
    memberProjects: [],
    memberProjectRefs: [],
    remoteEnvironmentLabels: [],
    environmentId: EnvironmentId.make("env"),
    pinned: false,
  }) as unknown as SidebarProjectSnapshot;

const items = [
  { value: "all", label: "All projects" },
  { value: "alpha", label: "Alpha" },
  { value: "beta", label: "Beta" },
];
const projects = new Map([
  ["alpha", project("alpha", "Alpha")],
  ["beta", project("beta", "Beta")],
]);

async function renderSubmenu(values: readonly string[]) {
  const onSelect = vi.fn();
  const onToggle = vi.fn();
  const onTogglePin = vi.fn();
  const screen = await render(
    <Menu open>
      <MenuTrigger>Options</MenuTrigger>
      <MenuPopup>
        <SidebarProjectFilterSubmenu
          items={items}
          values={values}
          open
          onOpenChange={() => undefined}
          projects={projects}
          shortcutLabels={new Map()}
          onSelect={onSelect}
          onToggle={onToggle}
          onProjectSettings={() => undefined}
          pin={{
            canPin: () => true,
            toggle: onTogglePin,
            keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
          }}
        />
      </MenuPopup>
    </Menu>,
    { router: false },
  );
  return { screen, onSelect, onToggle, onTogglePin };
}

it("Shift-click adds a project to the filter instead of replacing it", async () => {
  const { screen, onSelect, onToggle } = await renderSubmenu(["alpha"]);
  await using _screen = screen;

  await userEvent.keyboard("{Shift>}");
  await page.getByRole("menuitemradio", { name: "Beta" }).click();
  await userEvent.keyboard("{/Shift}");

  expect(onToggle).toHaveBeenCalledExactlyOnceWith("beta");
  expect(onSelect).not.toHaveBeenCalled();

  await page.getByRole("menuitemradio", { name: "Beta" }).click();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("beta");
});

it("summarizes several chosen projects on the submenu trigger", async () => {
  const { screen } = await renderSubmenu(["alpha", "beta"]);
  await using _screen = screen;

  await expect.element(page.getByText("2 projects")).toBeVisible();
});

it("pins the highlighted project with the thread pin shortcut", async () => {
  const { screen, onSelect, onTogglePin } = await renderSubmenu([]);
  await using _screen = screen;

  const beta = page.getByRole("menuitemradio", { name: "Beta" });
  await userEvent.hover(beta);
  const row = beta.element() as HTMLElement;
  row.focus();
  // The chat's pin shortcut steps aside for this list.
  expect(isInOpenProjectList(row)).toBe(true);
  const mod = isMacPlatform(navigator.platform) ? "Meta" : "Control";
  await userEvent.keyboard(`{${mod}>}{Shift>}p{/Shift}{/${mod}}`);

  expect(onTogglePin).toHaveBeenCalledExactlyOnceWith(projects.get("beta"));
  expect(onSelect).not.toHaveBeenCalled();
});
