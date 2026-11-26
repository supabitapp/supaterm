import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useSearch: (() => ({})) as never,
  useNavigate: (() => async () => undefined) as never,
}));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({
    environments: [
      {
        environmentId: "local",
        label: "Local",
        serverConfig: { environment: { capabilities: { issues: true } } },
      },
    ],
  })) as never,
  useIssuesSupported: (() => true) as never,
}));
vi.mock(import("~/state/issues"), async (original) => ({
  ...(await original()),
  useIssueList: (() => ({
    answers: [],
    isPending: false,
    refresh: () => undefined,
    reload: () => undefined,
    retry: () => undefined,
  })) as never,
}));
// A custom binding that only closes the panel, so it reads the page's live panel state.
vi.mock(import("~/state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@supaterm/shared/keybindings");
  return {
    ...actual,
    primaryServerKeybindingsAtom: Atom.make(
      compileResolvedKeybindingsConfig([
        { key: "f8", command: "rightPanel.toggle", when: "rightPanelOpen" },
      ]),
    ),
  };
});
vi.mock("~/components/issue/IssueDetailPanel", () => ({
  IssueDetailPanel: () => <p>Issue detail</p>,
}));

import {
  ISSUES_PANEL_REF,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "~/rightPanelStore";
import { runCommand } from "~/shortcuts/dispatcher";
import { IssuesPage } from "./IssuesPage";

const panel = () =>
  selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ISSUES_PANEL_REF);

it("answers the right panel commands that keys, menus and devices send", async () => {
  useRightPanelStore.setState({ byThreadKey: {} });
  useRightPanelStore.getState().openIssue(ISSUES_PANEL_REF, {
    environmentId: "local",
    projectId: "project",
    tracker: "github",
    host: "github.com",
    scope: "owner/repo",
    key: "1",
  });
  await using screen = await render(<IssuesPage />, { router: "/issues" });
  await expect.element(screen.getByText("Issue detail")).toBeInTheDocument();

  const run = (command: Parameters<typeof runCommand>[0]) =>
    act(() => runCommand(command, "device"));

  expect(await run("rightPanel.toggleMaximized")).toBe(true);
  await expect
    .element(screen.getByRole("button", { name: "Restore panel size" }))
    .toBeInTheDocument();

  expect(await run("rightPanel.toggle")).toBe(true);
  expect(panel().isOpen).toBe(false);
  expect(await run("rightPanel.toggle")).toBe(true);
  expect(panel().isOpen).toBe(true);

  expect(await run("rightPanel.close")).toBe(true);
  expect(panel().surfaces).toEqual([]);
});

it("matches a toggle bound only while the right panel is open", async () => {
  useRightPanelStore.setState({ byThreadKey: {} });
  useRightPanelStore.getState().openIssue(ISSUES_PANEL_REF, {
    environmentId: "local",
    projectId: "project",
    tracker: "github",
    host: "github.com",
    scope: "owner/repo",
    key: "1",
  });
  await using screen = await render(<IssuesPage />, { router: "/issues" });
  await expect.element(screen.getByText("Issue detail")).toBeInTheDocument();

  await userEvent.keyboard("{F8}");
  expect(panel().isOpen).toBe(false);
});
