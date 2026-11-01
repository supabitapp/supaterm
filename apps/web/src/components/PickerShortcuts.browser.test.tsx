import { EnvironmentId } from "@supaterm/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { Fragment, useState, type ReactNode } from "react";
import { act, render as renderUi, stubGlobal, type Screen } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";
import { BranchPicker } from "./BranchPicker";
import { ComboboxItem, ComboboxTrigger } from "./ui/combobox";

vi.mock(import("~/env"), async (original) => ({ ...(await original()), isElectron: true }));
vi.mock(import("../state/server"), async (original) => ({
  ...(await original()),
  primaryServerKeybindingsAtom: {} as never,
}));
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => DEFAULT_RESOLVED_KEYBINDINGS) as never,
}));
// Layout and scrolling belong to the virtualizer; exercise real combobox rows and keyboard handling.
vi.mock(import("@legendapp/list/react"), async (original) => ({
  ...(await original()),
  LegendList: (({
    data,
    renderItem,
  }: {
    data: string[];
    renderItem: (input: { item: string; index: number }) => ReactNode;
  }) => (
    <div>
      {data.map((item, index) => (
        <Fragment key={item}>{renderItem({ item, index })}</Fragment>
      ))}
    </div>
  )) as never,
}));

const environments = [
  {
    environmentId: EnvironmentId.make("laptop"),
    projectId: null,
    label: "Laptop",
    isPrimary: true,
    machine: "laptop" as const,
  },
  {
    environmentId: EnvironmentId.make("linux"),
    projectId: null,
    label: "Linux box",
    isPrimary: false,
    machine: "server" as const,
  },
  {
    environmentId: EnvironmentId.make("desktop"),
    projectId: null,
    label: "Desktop",
    isPrimary: false,
    machine: "mac-mini" as const,
  },
];

function HostPicker({
  locked = false,
  displayMode,
}: {
  locked?: boolean;
  displayMode: "toolbar" | "panel";
}) {
  const [environmentId, setEnvironmentId] = useState(environments[0]!.environmentId);
  const [auto, setAuto] = useState(false);
  return (
    <>
      <output>{auto ? "auto" : environmentId}</output>
      <BranchToolbarEnvironmentSelector
        displayMode={displayMode}
        envLocked={locked}
        environmentId={environmentId}
        availableEnvironments={environments}
        autoEnvironmentLabel={auto ? "Auto balance" : undefined}
        onAutoEnvironment={() => setAuto(true)}
        onEnvironmentChange={(id) => {
          setEnvironmentId(id);
          setAuto(false);
        }}
      />
    </>
  );
}

function RefPicker() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const items = ["create-new-ref", "locked", "main", "feature"];
  return (
    <>
      <output>{selected}</output>
      <BranchPicker
        items={items}
        filteredItems={items.filter((item) => item.includes(query))}
        value={selected}
        query={query}
        onQueryChange={setQuery}
        open={open}
        onOpenChange={setOpen}
        onSelectItem={setSelected}
        isItemShortcutEnabled={(item) => item !== "locked" && item !== "create-new-ref"}
        hasNextPage={false}
        isFetchingNextPage={false}
        onLoadNext={() => {}}
        statusText={null}
        popupProps={{}}
        renderItem={(item, index, jumpLabel) => (
          <ComboboxItem index={index} value={item} disabled={item === "locked"}>
            {item} {jumpLabel}
          </ComboboxItem>
        )}
      >
        <ComboboxTrigger aria-label="Select branch">Select branch</ComboboxTrigger>
      </BranchPicker>
    </>
  );
}

let screen: Screen;
async function setupTest() {
  await using resources = new AsyncDisposableStack();
  resources.use(vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel"));
  resources.use(
    stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    ),
  );
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  screen = resources.use(await renderUi(null, { router: false }));

  return resources.move();
}

async function openPicker(label: string) {
  await act(() =>
    screen.container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(),
  );
}
async function search(query: string) {
  const input = document.querySelector<HTMLInputElement>('input[data-slot="combobox-input"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function pressNumber(key: string) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(() => window.dispatchEvent(event));
  return event;
}

describe.each(["toolbar", "panel"] as const)("host picker in %s", (displayMode) => {
  it("selects the filtered host, resets search, and can return to auto balance", async () => {
    await using _test = await setupTest();
    await screen.rerender(<HostPicker displayMode={displayMode} />);
    await openPicker("Run on");
    await search("linux");
    await pressNumber("1");
    expect(screen.container.querySelector("output")!.textContent).toBe("linux");
    await openPicker("Run on");
    await pressNumber("4");
    expect(screen.container.querySelector("output")!.textContent).toBe("desktop");
    await openPicker("Run on");
    await pressNumber("1");
    expect(screen.container.querySelector("output")!.textContent).toBe("auto");
  });

  it("releases number shortcuts if the host becomes locked", async () => {
    await using _test = await setupTest();
    await screen.rerender(<HostPicker displayMode={displayMode} />);
    await openPicker("Run on");
    await screen.rerender(<HostPicker displayMode={displayMode} locked />);
    expect((await pressNumber("4")).defaultPrevented).toBe(false);
    expect(screen.container.querySelector("output")!.textContent).toBe("laptop");
  });
});

it("numbers the add action when the project is on one host", async () => {
  await using _test = await setupTest();
  const onAddToMachine = vi.fn();
  await screen.rerender(
    <BranchToolbarEnvironmentSelector
      envLocked={false}
      environmentId={environments[0]!.environmentId}
      availableEnvironments={[environments[0]!]}
      onAddToMachine={onAddToMachine}
    />,
  );
  await openPicker("Run on");
  expect((await pressNumber("2")).defaultPrevented).toBe(true);
  expect(onAddToMachine).toHaveBeenCalledOnce();
});

it("numbers enabled refs, skips actions, and follows the filtered branch list", async () => {
  await using _test = await setupTest();
  await screen.rerender(<RefPicker />);
  await openPicker("Select branch");
  await pressNumber("1");
  expect(screen.container.querySelector("output")!.textContent).toBe("main");
  await openPicker("Select branch");
  await search("feature");
  await pressNumber("1");
  expect(screen.container.querySelector("output")!.textContent).toBe("feature");
  expect((await pressNumber("1")).defaultPrevented).toBe(false);
});
