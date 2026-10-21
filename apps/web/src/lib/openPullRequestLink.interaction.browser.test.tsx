import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { act, render as renderUi, type Screen } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

// The desktop cases; openPullRequestLink.web.browser.test.tsx covers a plain browser, where
// isElectron is already false. A mocked module's exports are fixed once it loads.
const state = vi.hoisted(() => ({
  withThread: false,
  navigate: vi.fn(),
  openExternal: vi.fn().mockResolvedValue(undefined),
  openPreview: vi.fn(),
}));

vi.mock(import("../env"), async (original) => ({ ...(await original()), isElectron: true }));
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

import { useOpenPrLink } from "./openPullRequestLink";

const url = "https://github.com/acme/app/pull/42";
const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const parentClick = vi.fn();
let screen: Screen;

function Link({ button = false }: { button?: boolean }) {
  const openPrLink = useOpenPrLink(state.withThread ? threadRef : undefined);
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
  state.withThread = false;
  screen = resources.use(await renderUi(null, { router: false }));

  return resources.move();
}

async function clickLink(options: MouseEventInit = {}, button = false) {
  await screen.rerender(<Link button={button} />);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...options });
  await act(async () => {
    screen.container.querySelector("a, button")!.dispatchEvent(event);
  });
  expect(parentClick).not.toHaveBeenCalled();
  return event;
}

describe("PR link navigation on desktop", () => {
  it.each(["metaKey", "ctrlKey"])(
    "opens desktop %s-clicks externally with in-app browsing preferred",
    async (modifier) => {
      await using _test = await setupTest();
      state.withThread = true;
      const event = await clickLink({ [modifier]: true });
      expect(event.defaultPrevented).toBe(true);
      expect(state.openExternal).toHaveBeenCalledExactlyOnceWith(url);
      expect(state.openPreview).not.toHaveBeenCalled();
      expect(state.navigate).not.toHaveBeenCalled();
    },
  );

  it("opens modified buttons externally", async () => {
    await using _test = await setupTest();
    const event = await clickLink({ metaKey: true }, true);
    expect(event.defaultPrevented).toBe(true);
    expect(state.openExternal).toHaveBeenCalledExactlyOnceWith(url);
    expect(state.openPreview).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("opens ordinary clicks in the PR view", async () => {
    await using _test = await setupTest();
    const event = await clickLink();
    expect(event.defaultPrevented).toBe(true);
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/pull-requests",
      search: expect.objectContaining({ repository: "acme/app", number: 42 }),
    });
    expect(state.openExternal).not.toHaveBeenCalled();
    expect(state.openPreview).not.toHaveBeenCalled();
  });
});
