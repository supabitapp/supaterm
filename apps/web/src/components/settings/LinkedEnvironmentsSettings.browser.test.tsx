import type { LinkableMachine } from "@supaterm/client-runtime/link-request";
import { DEFAULT_SERVER_SETTINGS, EnvironmentId, type ServerSettings } from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

const state = vi.hoisted(() => ({
  linkCommand: { label: "link" },
  unlinkCommand: { label: "unlink" },
  granted: { label: "granted" },
  environments: [] as ReadonlyArray<unknown>,
  linkHosts: [] as ReadonlyArray<unknown>,
  machines: [] as ReadonlyArray<unknown>,
  link: vi.fn(),
  updateSettings: vi.fn(),
  mint: vi.fn(),
}));
vi.mock(import("~/state/environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironments: (() => ({ environments: state.environments })) as never,
  usePrimaryEnvironmentId: () => null,
  usePrimaryEnvironment: () => null,
}));
vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProjects: (() => []) as never,
}));
vi.mock(import("~/state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
  useEnvironmentsWithScope: (environments) =>
    new Set(environments.map(({ environmentId }) => environmentId)),
  usePreparedConnection: (() => Option.some({})) as never,
}));
vi.mock(import("~/state/peerLinks"), () => ({
  peerLinkEnvironment: {
    list: () => null,
    link: Object.assign(state.linkCommand, { permissionAtom: () => state.granted }),
    unlink: Object.assign(state.unlinkCommand, { permissionAtom: () => state.granted }),
  } as never,
  usePeerLinkHosts: (() => state.linkHosts) as never,
  useLinkableMachines: (() => state.machines) as never,
}));
vi.mock(import("~/state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: (() => ({ data: { links: [] }, error: null })) as never,
}));
vi.mock(import("@effect/atom-react"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAtomValue: ((atom: unknown) =>
      atom === state.granted ? true : actual.useAtomValue(atom as never)) as never,
  };
});
vi.mock(import("~/state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: ((command: unknown) =>
    command === state.linkCommand ? state.link : state.updateSettings) as never,
}));
vi.mock(import("~/state/peerPairingCode"), () => ({ mintPairingCodeOn: state.mint }));

import { render } from "../../../test/render";
import { LinkedEnvironmentsSettings } from "./LinkedEnvironmentsSettings";

const environment = (
  id: string,
  settings: Partial<ServerSettings>,
  capabilities: { readonly peerLinks?: boolean } = { peerLinks: true },
) => ({
  environmentId: EnvironmentId.make(id),
  label: id,
  connection: { phase: "connected" },
  serverConfig: {
    settings: { ...DEFAULT_SERVER_SETTINGS, ...settings },
    environment: { platform: { machine: "server" }, capabilities },
  },
});
const laptop = environment("laptop", { linkedEnvironmentsEnabled: false });
const studio = environment("studio", { linkedEnvironmentsEnabled: true });
const older = environment("older", {}, {});

const vps = {
  environmentId: EnvironmentId.make("vps"),
  label: "VPS",
  machine: "server",
  connected: true,
  linked: false,
  urls: ["https://vps.example.ts.net", "http://100.64.0.2:3773"],
} satisfies LinkableMachine;
const relayOnly = {
  environmentId: EnvironmentId.make("relay-only"),
  label: "Relay only",
  machine: "laptop",
  connected: true,
  linked: false,
  urls: [],
} satisfies LinkableMachine;

function setup() {
  vi.clearAllMocks();
  state.environments = [laptop, studio, older];
  state.linkHosts = [studio];
  state.machines = [vps, relayOnly];
  state.link.mockResolvedValue({ _tag: "Success", value: { label: "VPS" } });
  state.updateSettings.mockImplementation(async ({ input }) => ({
    _tag: "Success",
    value: { ...DEFAULT_SERVER_SETTINGS, ...input.patch },
  }));
  state.mint.mockResolvedValue(Result.succeed("minted-code"));
}

const button = (name: string) => page.getByRole("button", { name, exact: true });

async function openLinkDialog(machine: string) {
  await button("Link").click();
  await page.getByRole("combobox", { name: "Machine" }).click();
  await page.getByRole("option", { name: machine }).click();
}

it("gives each machine that can link its own switch, and its links once that is on", async () => {
  setup();
  await using screen = await render(<LinkedEnvironmentsSettings />);

  const switches = screen.getByRole("switch", { name: "Linked environments" });
  await expect.element(switches.nth(0)).not.toBeChecked();
  await expect.element(switches.nth(1)).toBeChecked();
  expect(switches.elements()).toHaveLength(2);
  const sections = [...screen.container.querySelectorAll("section")].map((section) => ({
    title: section.querySelector("h2")?.textContent,
    listsLinks: section.textContent.includes("No linked environments"),
    canLink: section.querySelector("button[data-slot='dialog-trigger']") !== null,
  }));
  expect(sections).toEqual([
    { title: "Linked environments · laptop", listsLinks: false, canLink: false },
    { title: "Linked environments · studio", listsLinks: true, canLink: true },
  ]);

  await switches.nth(0).click();
  await vi.waitFor(() => expect(state.updateSettings).toHaveBeenCalledTimes(1));
  expect(state.updateSettings).toHaveBeenCalledWith({
    environmentId: laptop.environmentId,
    input: { patch: { linkedEnvironmentsEnabled: true } },
  });
});

it.each(["Another address…", relayOnly.label])(
  "links %s by a typed address and a pasted code, never one it mints",
  async (machine) => {
    setup();
    await using _screen = await render(<LinkedEnvironmentsSettings />);

    await openLinkDialog(machine);
    await page.getByRole("textbox", { name: /^Address/ }).fill("https://user@box.example/app");
    await expect
      .element(page.getByRole("alert").getByText("https://box.example", { exact: true }))
      .toBeInTheDocument();
    await expect.element(button("Link")).toBeDisabled();
    await page.getByRole("textbox", { name: /^Pairing code/ }).fill("pasted-code");
    await button("Link").click();

    await vi.waitFor(() => expect(state.link).toHaveBeenCalledTimes(1));
    expect(state.mint).not.toHaveBeenCalled();
    expect(state.link).toHaveBeenCalledWith({
      environmentId: studio.environmentId,
      input: {
        url: "https://user@box.example/app",
        pairingCode: "pasted-code",
        access: "approval-required",
      },
    });
  },
);

it("links a machine it has an address for with a code minted there", async () => {
  setup();
  await using _screen = await render(<LinkedEnvironmentsSettings />);

  await openLinkDialog(vps.label);
  await expect
    .element(page.getByRole("textbox", { name: /^Pairing code/ }))
    .not.toBeInTheDocument();
  await button("Link").click();

  await vi.waitFor(() => expect(state.link).toHaveBeenCalledTimes(1));
  expect(state.mint).toHaveBeenCalledWith(vps.environmentId, "approval-required");
  expect(state.link).toHaveBeenCalledWith({
    environmentId: studio.environmentId,
    input: {
      url: vps.urls[0],
      alternateUrls: [vps.urls[1]],
      expectedEnvironmentId: vps.environmentId,
      expectedLabel: "VPS",
      pairingCode: "minted-code",
      access: "approval-required",
    },
  });
});
