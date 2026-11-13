import type { LinkableMachine, LinkRequestItem } from "@supaterm/client-runtime/link-request";
import { EnvironmentId, ThreadId, TurnItemId } from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  answerPermission: { label: "answer-permission" },
  permissionAtom: vi.fn(),
  canAnswer: true,
  machines: [] as ReadonlyArray<unknown>,
  answer: vi.fn(),
  mint: vi.fn(),
}));
vi.mock(import("../../state/peerLinks"), () => ({
  peerLinkEnvironment: { answerRequest: { permissionAtom: state.permissionAtom } } as never,
  useLinkableMachines: (() => state.machines) as never,
}));
vi.mock(import("@effect/atom-react"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAtomValue: ((atom: unknown) =>
      atom === state.answerPermission
        ? state.canAnswer
        : actual.useAtomValue(atom as never)) as never,
  };
});
vi.mock(import("../../state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: (() => state.answer) as never,
}));
vi.mock(import("../../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => true,
  usePreparedConnection: (() => Option.some({})) as never,
}));
vi.mock(import("../../state/peerPairingCode"), () => ({ mintPairingCodeOn: state.mint }));

import { render } from "../../../test/render";
import { LinkRequestCard } from "./LinkRequestCard";

const environmentId = EnvironmentId.make("laptop");
const studio = {
  environmentId: EnvironmentId.make("studio"),
  label: "Studio",
  machine: "desktop",
  connected: true,
  linked: false,
  urls: ["https://studio.example.ts.net"],
} satisfies LinkableMachine;
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
const UNPLACED_ADDRESS = "https://studio.example.ts.net.evil.example/pair?next=1";

const request = (fields: Partial<LinkRequestItem> = {}) =>
  ({
    id: TurnItemId.make("turn-item:link-request:1"),
    threadId: ThreadId.make("thread-1"),
    type: "link_request",
    reason: "Run the suite on a bigger machine.",
    linkStatus: "pending",
    ...fields,
  }) as LinkRequestItem;

function setup(input: { readonly canAnswer?: boolean } = {}) {
  vi.clearAllMocks();
  state.canAnswer = input.canAnswer ?? true;
  state.machines = [studio, vps, relayOnly];
  state.permissionAtom.mockReturnValue(state.answerPermission);
  state.answer.mockResolvedValue({ _tag: "Success" });
  state.mint.mockResolvedValue(Result.succeed("minted-code"));
}

const card = (item: LinkRequestItem) => (
  <LinkRequestCard environmentId={environmentId} item={item} visibility="local" />
);
const button = (name: string) => page.getByRole("button", { name, exact: true });

it("links the machine and access the user picked, with a code minted there", async () => {
  setup();
  const item = request();
  await using _screen = await render(card(item));

  await button("Choose machine…").click();
  await page.getByText("VPS", { exact: true }).click();
  await button("Continue").click();
  await page.getByRole("combobox", { name: "What agents here may do there" }).click();
  await page.getByRole("option", { name: /Full access/ }).click();
  await button("Link").click();

  await vi.waitFor(() => expect(state.answer).toHaveBeenCalledTimes(1));
  expect(state.mint).toHaveBeenCalledWith(vps.environmentId, "full-access");
  expect(state.answer).toHaveBeenCalledWith({
    environmentId,
    input: {
      threadId: item.threadId,
      turnItemId: item.id,
      answer: {
        type: "link",
        environmentId: vps.environmentId,
        label: "VPS",
        urls: vps.urls,
        access: "full-access",
        pairingCode: "minted-code",
      },
    },
  });
});

it.each([true, false])("answers only with the access permission (%s)", async (canAnswer) => {
  setup({ canAnswer });
  const item = request();
  await using _screen = await render(card(item));

  expect(state.permissionAtom).toHaveBeenCalledWith(environmentId);
  if (!canAnswer) {
    await expect.element(button("Choose machine…")).not.toBeInTheDocument();
    await expect.element(button("Decline")).not.toBeInTheDocument();
    return;
  }
  await button("Decline").click();
  await vi.waitFor(() =>
    expect(state.answer).toHaveBeenCalledWith({
      environmentId,
      input: { threadId: item.threadId, turnItemId: item.id, answer: { type: "decline" } },
    }),
  );
});

it.each([
  {
    target: "an address the agent gave",
    item: request({ url: UNPLACED_ADDRESS }),
    open: async () => {
      await button("Review link…").click();
    },
  },
  {
    target: "a machine this app has no address for",
    item: request(),
    open: async () => {
      await button("Choose machine…").click();
      await page.getByText(relayOnly.label, { exact: true }).click();
      await page.getByRole("textbox", { name: /^Address/ }).fill(UNPLACED_ADDRESS);
      await button("Continue").click();
    },
  },
])("sends $target only a pasted code, after naming where it leads", async ({ item, open }) => {
  setup();
  await using _screen = await render(card(item));

  await open();
  await expect
    .element(
      page
        .getByRole("alert")
        .getByText("https://studio.example.ts.net.evil.example", { exact: true }),
    )
    .toBeInTheDocument();
  await expect.element(button("Link")).toBeDisabled();
  await page.getByRole("textbox", { name: /^Pairing code/ }).fill("pasted-code");
  await button("Link").click();

  await vi.waitFor(() => expect(state.answer).toHaveBeenCalledTimes(1));
  expect(state.mint).not.toHaveBeenCalled();
  expect(state.answer.mock.calls[0]![0].input.answer).toEqual({
    type: "link",
    urls: [UNPLACED_ADDRESS],
    access: "approval-required",
    pairingCode: "pasted-code",
  });
});
