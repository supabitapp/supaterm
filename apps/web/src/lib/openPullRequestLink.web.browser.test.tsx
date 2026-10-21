import { act, render as renderUi, type Screen } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

// The plain browser cases: no desktop bridge, so isElectron is false as in a web client.
const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  openExternal: vi.fn().mockResolvedValue(undefined),
  openPreview: vi.fn(),
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  readProjects: (() => [
    {
      id: "project-1",
      environmentId: "environment-1",
      repositoryIdentity: {
        canonicalKey: "github.com/acme/app",
        provider: "github",
        owner: "acme",
        name: "app",
      },
    },
  ]) as never,
}));
vi.mock(import("../state/server"), async (importOriginal) => {
  const { Atom } = await import("effect/reactivity");
  return {
    ...(await importOriginal()),
    environmentServerConfigsAtom: Atom.make(
      new Map([["environment-1", { environment: { capabilities: {} } }]]),
    ) as never,
  };
});
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: (() => "environment-1") as never,
}));
vi.mock(import("~/localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: (() => ({ shell: { openExternal: state.openExternal } })) as never,
}));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.openPreview) as never,
}));
vi.mock(import("~/state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  readEnvironmentScope: () => true,
}));
vi.mock(import("../browser/browserLinkTarget"), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveBrowserLinkTargetPreference: async () => "app" as const,
  canOpenLinksInApp: () => true,
}));

import { isElectron } from "../env";
import { useOpenPrLink } from "./openPullRequestLink";

const url = "https://github.com/acme/app/pull/42";
const parentClick = vi.fn();
let screen: Screen;

function Link({ button = false }: { button?: boolean }) {
  const openPrLink = useOpenPrLink();
  return (
    <div onClick={parentClick}>
      {button ? (
        <button type="button" onClick={(event) => openPrLink(event, url)}>
          PR #42
        </button>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => openPrLink(event, url)}
        >
          PR #42
        </a>
      )}
    </div>
  );
}

async function setupTest() {
  await using resources = new AsyncDisposableStack();

  vi.clearAllMocks();
  screen = resources.use(await renderUi(null, { router: false }));

  return resources.move();
}

async function clickLink(options: MouseEventInit = {}, button = false) {
  await screen.rerender(<Link button={button} />);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...options });
  let defaultPrevented: boolean | undefined;
  // Record what the link decided, then keep the real browser from following it. React handles
  // the click on the root container and stops it there, so this listener sits beside React's.
  const stopNavigation = (seen: Event) => {
    defaultPrevented = seen.defaultPrevented;
    seen.preventDefault();
  };
  screen.container.addEventListener("click", stopNavigation, { once: true });
  await act(async () => {
    screen.container.querySelector("a, button")!.dispatchEvent(event);
  });
  expect(parentClick).not.toHaveBeenCalled();
  return defaultPrevented;
}

describe("PR link navigation in a browser", () => {
  it("runs outside the desktop app", () => {
    expect(isElectron).toBe(false);
  });

  it.each(["metaKey", "ctrlKey"])(
    "preserves native browser %s-click navigation",
    async (modifier) => {
      await using _test = await setupTest();
      expect(await clickLink({ [modifier]: true })).toBe(false);
      expect(state.openExternal).not.toHaveBeenCalled();
      expect(state.openPreview).not.toHaveBeenCalled();
      expect(state.navigate).not.toHaveBeenCalled();
    },
  );

  it("opens modified buttons externally", async () => {
    await using _test = await setupTest();
    expect(await clickLink({ metaKey: true }, true)).toBe(true);
    expect(state.openExternal).toHaveBeenCalledExactlyOnceWith(url);
    expect(state.openPreview).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("opens ordinary clicks in the PR view", async () => {
    await using _test = await setupTest();
    expect(await clickLink()).toBe(true);
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/pull-requests",
      search: expect.objectContaining({ repository: "acme/app", number: 42 }),
    });
    expect(state.openExternal).not.toHaveBeenCalled();
    expect(state.openPreview).not.toHaveBeenCalled();
  });
});
