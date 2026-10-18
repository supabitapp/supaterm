// @vitest-environment jsdom

import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  isElectron: true,
  withThread: false,
  navigate: vi.fn(),
  openExternal: vi.fn().mockResolvedValue(undefined),
  openPreview: vi.fn(),
}));

vi.mock("../env", () => ({
  get isElectron() {
    return state.isElectron;
  },
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("../state/entities", () => ({
  useProjects: () => [
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
  ],
}));
vi.mock("../state/server", async (importOriginal) => {
  const { Atom } = await import("effect/reactivity");
  return {
    ...(await importOriginal<typeof import("../state/server")>()),
    environmentServerConfigsAtom: Atom.make(
      new Map([["environment-1", { environment: { capabilities: {} } }]]),
    ),
  };
});
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "environment-1" }));
vi.mock("~/localApi", () => ({
  readLocalApi: () => ({ shell: { openExternal: state.openExternal } }),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.openPreview }));
vi.mock("~/state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/state/session")>()),
  readEnvironmentScope: () => true,
}));
vi.mock("../browser/browserLinkTarget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../browser/browserLinkTarget")>()),
  resolveBrowserLinkTargetPreference: async () => "app",
  canOpenLinksInApp: () => true,
}));

import { useOpenPrLink } from "./openPullRequestLink";

const url = "https://github.com/acme/app/pull/42";
const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const parentClick = vi.fn();
let container: HTMLDivElement;
let root: Root;

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.isElectron = true;
  state.withThread = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function clickLink(options: MouseEventInit = {}, button = false) {
  await act(async () => root.render(<Link button={button} />));
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...options });
  await act(async () => {
    container.querySelector("a, button")!.dispatchEvent(event);
  });
  expect(parentClick).not.toHaveBeenCalled();
  return event;
}

describe("PR link navigation", () => {
  it.each(["metaKey", "ctrlKey"])(
    "opens desktop %s-clicks externally with in-app browsing preferred",
    async (modifier) => {
      state.withThread = true;
      const event = await clickLink({ [modifier]: true });
      expect(event.defaultPrevented).toBe(true);
      expect(state.openExternal).toHaveBeenCalledExactlyOnceWith(url);
      expect(state.openPreview).not.toHaveBeenCalled();
      expect(state.navigate).not.toHaveBeenCalled();
    },
  );

  it.each(["metaKey", "ctrlKey"])(
    "preserves native browser %s-click navigation",
    async (modifier) => {
      state.isElectron = false;
      const event = await clickLink({ [modifier]: true });
      expect(event.defaultPrevented).toBe(false);
      expect(state.openExternal).not.toHaveBeenCalled();
      expect(state.openPreview).not.toHaveBeenCalled();
      expect(state.navigate).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])("opens modified buttons externally (desktop: %s)", async (isElectron) => {
    state.isElectron = isElectron;
    const event = await clickLink({ metaKey: true }, true);
    expect(event.defaultPrevented).toBe(true);
    expect(state.openExternal).toHaveBeenCalledExactlyOnceWith(url);
    expect(state.openPreview).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "opens ordinary clicks in the PR view (desktop: %s)",
    async (isElectron) => {
      state.isElectron = isElectron;
      const event = await clickLink();
      expect(event.defaultPrevented).toBe(true);
      expect(state.navigate).toHaveBeenCalledWith({
        to: "/pull-requests",
        search: expect.objectContaining({ repository: "acme/app", number: 42 }),
      });
      expect(state.openExternal).not.toHaveBeenCalled();
      expect(state.openPreview).not.toHaveBeenCalled();
    },
  );
});
