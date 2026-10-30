import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@react-navigation/native", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const nativeRequire = createRequire(require.resolve("@react-navigation/native/package.json"));
  const core = nativeRequire("@react-navigation/core");
  return {
    getStateFromPath: core.getStateFromPath,
    CommonActions: core.CommonActions,
    StackActions: core.StackActions,
  };
});
vi.mock("../features/workspace/workspace-selection-store", () => ({
  settingsLinkPage: () => undefined,
  workspaceHasColumns: () => false,
}));
vi.mock("../features/prompt-links/threadPromptLink", () => ({
  takeThreadPromptLink: (state: unknown) => state,
}));
vi.mock("../features/prompt-links/newTaskPromptLink", () => ({
  takeNewTaskPromptLink: (state: unknown) => state,
}));
vi.mock("../features/settings/scheduled-task-editor-state", () => ({
  takeScheduledTaskNewLink: (state: unknown) => state,
}));
vi.mock("../state/use-remote-environment-registry", () => ({ pairEnvironment: vi.fn() }));
vi.mock("./rootNavigation", () => ({ rootNavigationRef: {}, whenRootNavigationReady: vi.fn() }));

import { getAppStateFromPath } from "./appLinkState";
import { findLinkedRoute } from "./appLinking";
import { PAIRING_FORM_LINK_PATHS } from "./pairingLinkPaths";

const linking = { initialRouteName: "Home", screens: { Home: "", ...PAIRING_FORM_LINK_PATHS } };

describe("pairing link parsing", () => {
  it.each(Object.entries(PAIRING_FORM_LINK_PATHS))(
    "removes a saved target from %s",
    (name, path) => {
      vi.stubGlobal("__DEV__", false);
      const state = getAppStateFromPath(
        `${path}?routeFor=saved-environment&pairingUrl=untrusted&autoConnect=1`,
        linking,
      );
      const route = findLinkedRoute(state, [name]);
      expect(route?.params).not.toHaveProperty("routeFor");
      expect(route?.params).toMatchObject({ pairingUrl: "untrusted", autoConnect: "1" });
    },
  );

  it("preserves unrelated route parameters", () => {
    vi.stubGlobal("__DEV__", false);
    const state = getAppStateFromPath("connections/new?mode=manual", linking);
    expect(findLinkedRoute(state, ["ConnectionsNew"])?.params).toEqual({ mode: "manual" });
  });
});
