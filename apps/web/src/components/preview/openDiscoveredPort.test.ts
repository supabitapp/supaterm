import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";

const openPreviewSession = vi.fn();
vi.mock("./openPreviewSession", () => ({ openPreviewSession }));
vi.mock("~/state/session", () => ({
  readPreparedConnection: () => ({
    httpBaseUrl: "http://127.0.0.1:5774",
    connectionMethod: "relay",
  }),
  readEnvironmentScope: () => false,
}));
vi.mock("~/state/entities", () => ({
  readEnvironmentSupportsServerBrowser: () => false,
  readEnvironmentServerConfig: () => null,
}));
vi.mock("~/browser/previewRuntime", () => ({ previewRuntimeFor: () => undefined }));
vi.mock("~/browserHistoryStore", () => ({ recordVisitForThread: vi.fn() }));
vi.mock("~/rightPanelStore", () => ({ useRightPanelStore: { getState: vi.fn() } }));

describe("discovered relay port navigation", () => {
  it("reports unsupported host previews without opening a client-local port", async () => {
    const { openDiscoveredPort } = await import("./openDiscoveredPort");
    const openPreview = vi.fn();
    const result = await openDiscoveredPort({
      threadRef: { environmentId: EnvironmentId.make("remote"), threadId: ThreadId.make("thread") },
      port: {
        host: "127.0.0.1",
        port: 5173,
        url: "http://localhost:5173/",
        processName: null,
        pid: null,
        terminal: null,
      },
      openPreview,
    });
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure")
      expect(squashAtomCommandFailure(result)).toMatchObject({
        message: "Relay port previews require browser support on the host.",
      });
    expect(openPreviewSession).not.toHaveBeenCalled();
    expect(openPreview).not.toHaveBeenCalled();
  });
});
