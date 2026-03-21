import { createServer, type Server } from "net";
import { mkdirSync, unlinkSync, existsSync } from "fs";
import { dirname, join } from "path";
import type { SpRequest, SpResponse, NewPaneRequest, TreeSnapshot } from "@supaterm/shared";
import { SP_METHODS, leaves } from "@supaterm/shared";
import type { WorkspaceStateManager } from "./workspace-state.js";
import { CONFIG_DIR } from "./persistence.js";

const DEFAULT_SOCKET_PATH = join(CONFIG_DIR, "supaterm.sock");

function respond(
  connection: import("net").Socket,
  response: SpResponse,
): void {
  connection.write(JSON.stringify(response) + "\n");
}

export function startSpSocket(
  workspaceState: WorkspaceStateManager,
  socketPath?: string,
): { server: Server; path: string } {
  const path = socketPath ?? DEFAULT_SOCKET_PATH;
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {}
  }

  const server = createServer((connection) => {
    let buffer = "";

    connection.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const request: SpRequest = JSON.parse(trimmed);
          const response = handleRequest(request, workspaceState);
          respond(connection, response);
        } catch (err) {
          respond(connection, {
            ok: false,
            error: {
              code: "parse_error",
              message: err instanceof Error ? err.message : "Invalid JSON",
            },
          });
        }
      }
    });

    connection.on("error", () => {});
  });

  server.listen(path, () => {
    console.log(`sp socket listening on ${path}`);
  });

  server.on("error", (err) => {
    console.error("sp socket error:", err.message);
  });

  return { server, path };
}

function handleRequest(
  request: SpRequest,
  workspaceState: WorkspaceStateManager,
): SpResponse {
  switch (request.method) {
    case SP_METHODS.SYSTEM_PING:
      return { id: request.id, ok: true, result: { pong: true } };

    case SP_METHODS.APP_TREE: {
      const snapshot = buildTreeSnapshot(workspaceState);
      return { id: request.id, ok: true, result: snapshot };
    }

    case SP_METHODS.TERMINAL_NEW_PANE: {
      try {
        const params = request.params as NewPaneRequest;
        const direction = params.direction ?? "right";
        const focus = params.focus ?? true;

        const state = workspaceState.getSnapshot();
        let tabId: string | undefined;

        if (params.targetTabIndex !== undefined) {
          const tab = state.tabs[params.targetTabIndex - 1];
          tabId = tab?.id;
        } else if (params.contextPaneID) {
          const pane = state.panes[params.contextPaneID];
          tabId = pane?.tabId;
        } else {
          tabId = state.selectedTabId ?? undefined;
        }

        if (!tabId) {
          return {
            id: request.id,
            ok: false,
            error: { code: "not_found", message: "No target tab found" },
          };
        }

        const { pane } = workspaceState.createPane(
          tabId,
          direction,
          params.contextPaneID,
          params.command,
          focus,
        );

        const newState = workspaceState.getSnapshot();
        const tabIndex = newState.tabs.findIndex((t) => t.id === tabId);
        const tree = newState.trees[tabId];
        const paneIds = tree ? leaves(tree) : [];
        const paneIndex = paneIds.indexOf(pane.id);

        return {
          id: request.id,
          ok: true,
          result: {
            direction,
            isFocused: focus,
            isSelectedTab: tabId === newState.selectedTabId,
            paneIndex: paneIndex + 1,
            tabIndex: tabIndex + 1,
            windowIndex: 1,
          },
        };
      } catch (err) {
        return {
          id: request.id,
          ok: false,
          error: {
            code: "creation_failed",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }

    default:
      return {
        id: request.id,
        ok: false,
        error: {
          code: "unknown_method",
          message: `Unknown method: ${request.method}`,
        },
      };
  }
}

function buildTreeSnapshot(
  workspaceState: WorkspaceStateManager,
): TreeSnapshot {
  const state = workspaceState.getSnapshot();

  const workspaceSnapshots = state.workspaces.map((ws, wsIdx) => {
    const wsTabs = state.tabs.filter((t) => t.workspaceId === ws.id);
    const tabSnapshots = wsTabs.map((tab, tabIdx) => {
      const tree = state.trees[tab.id];
      const paneIds = tree ? leaves(tree) : [];
      const focusedPaneId = state.focusedPaneByTab[tab.id];
      const paneSnapshots = paneIds.map((paneId, paneIdx) => ({
        index: paneIdx + 1,
        isFocused: paneId === focusedPaneId,
      }));

      return {
        index: tabIdx + 1,
        title: tab.title,
        isSelected: tab.id === state.selectedTabId,
        panes: paneSnapshots,
      };
    });

    return {
      index: wsIdx + 1,
      name: ws.name,
      isSelected: ws.id === state.selectedWorkspaceId,
      tabs: tabSnapshots,
    };
  });

  return {
    windows: [
      {
        index: 1,
        isKey: true,
        workspaces: workspaceSnapshots,
      },
    ],
  };
}
