import { PtyManager, type PtyWsData } from "./pty-manager.js";
import {
  WorkspaceStateManager,
  type ControlWsData,
} from "./workspace-state.js";
import type { ClientMessage } from "@supaterm/shared";
import { resolve, join } from "path";
import { startSpSocket } from "./sp-socket.js";
import { initAuth, validateToken, isAuthEnabled } from "./auth.js";

const PORT = parseInt(process.env.PORT ?? "7681", 10);
const WEB_DIST = resolve(
  import.meta.dirname,
  process.env.WEB_DIST ?? "../../web/dist",
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// --- Initialize ---

const authToken = initAuth();
const ptyManager = new PtyManager();
const workspaceState = new WorkspaceStateManager(ptyManager);
workspaceState.bootstrap();

// --- Handle control messages ---

function handleControlMessage(
  ws: Bun.ServerWebSocket<ControlWsData>,
  msg: ClientMessage,
): void {
  try {
    switch (msg.type) {
      case "sync":
        ws.sendText(
          JSON.stringify({ type: "sync", state: workspaceState.getSnapshot() }),
        );
        break;

      case "create_tab":
        workspaceState.createTab();
        break;

      case "close_tab":
        workspaceState.closeTab(msg.tabId);
        break;

      case "select_tab":
        workspaceState.selectTab(msg.tabId);
        break;

      case "select_tab_slot":
        workspaceState.selectTabSlot(msg.slot);
        break;

      case "next_tab":
        workspaceState.nextTab();
        break;

      case "previous_tab":
        workspaceState.previousTab();
        break;

      case "create_pane":
        workspaceState.createPane(
          msg.tabId,
          msg.direction,
          msg.targetPaneId,
          msg.command,
          msg.focus,
        );
        break;

      case "close_pane":
        workspaceState.closePane(msg.paneId);
        break;

      case "resize_pane":
        workspaceState.resizePane(msg.paneId, msg.cols, msg.rows);
        break;

      case "focus_pane":
        workspaceState.focusPane(msg.paneId);
        break;

      case "equalize_panes":
        workspaceState.equalizePanes(msg.tabId);
        break;

      case "toggle_zoom":
        workspaceState.toggleZoom(msg.tabId);
        break;

      case "split_resize":
        workspaceState.resizeSplit(msg.paneId, msg.delta, msg.axis);
        break;

      case "create_workspace":
        workspaceState.createWorkspace();
        break;

      case "delete_workspace":
        workspaceState.deleteWorkspace(msg.workspaceId);
        break;

      case "rename_workspace":
        workspaceState.renameWorkspace(msg.workspaceId, msg.name);
        break;

      case "select_workspace":
        workspaceState.selectWorkspace(msg.workspaceId);
        break;

      default:
        workspaceState.broadcast({
          type: "error",
          code: "unknown_command",
          message: `Unknown command: ${(msg as { type: string }).type}`,
        });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ws.sendText(
      JSON.stringify({ type: "error", code: "command_failed", message }),
    );
  }
}

// --- Serve ---

const server = Bun.serve<PtyWsData | ControlWsData>({
  port: PORT,
  hostname: "0.0.0.0",

  async fetch(req, server) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);

    if (
      (url.pathname.startsWith("/pty/") || url.pathname === "/control") &&
      !validateToken(url)
    ) {
      return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
    }

    if (url.pathname.startsWith("/pty/")) {
      const paneId = url.pathname.split("/")[2];
      if (!paneId) return new Response("Missing pane ID", { status: 400 });

      const upgraded = server.upgrade(req, {
        data: { type: "pty" as const, paneId },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    if (url.pathname === "/control") {
      const upgraded = server.upgrade(req, {
        data: { type: "control" as const },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    if (url.pathname === "/api/health") {
      // Only expose token to same-origin or localhost requests
      const origin = req.headers.get("origin") ?? "";
      const isLocal = !origin || origin.includes("localhost") || origin.includes("127.0.0.1");
      return Response.json(
        { ok: true, ...(isAuthEnabled() && isLocal ? { token: authToken } : {}) },
        { headers: CORS_HEADERS },
      );
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const file = Bun.file(join(WEB_DIST, "index.html"));
      if (await file.exists()) return new Response(file);
    }

    if (url.pathname.startsWith("/assets/")) {
      const file = Bun.file(join(WEB_DIST, url.pathname));
      if (await file.exists()) return new Response(file);
    }

    const indexFile = Bun.file(join(WEB_DIST, "index.html"));
    if (await indexFile.exists()) return new Response(indexFile);

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const data = ws.data;
      if (data.type === "pty") {
        ptyManager.addClient(
          data.paneId,
          ws as Bun.ServerWebSocket<PtyWsData>,
        );
      }
      if (data.type === "control") {
        const controlWs = ws as Bun.ServerWebSocket<ControlWsData>;
        workspaceState.registerControlClient(controlWs);
        controlWs.sendText(
          JSON.stringify({
            type: "sync",
            state: workspaceState.getSnapshot(),
          }),
        );
      }
    },

    message(ws, message) {
      const data = ws.data;
      if (data.type === "pty") {
        if (message instanceof ArrayBuffer) {
          ptyManager.write(data.paneId, new Uint8Array(message));
        } else if (typeof message === "string") {
          try {
            const parsed = JSON.parse(message);
            if (parsed.type === "input" && typeof parsed.data === "string") {
              ptyManager.write(data.paneId, parsed.data);
            } else if (parsed.type === "resize") {
              ptyManager.resize(data.paneId, parsed.cols, parsed.rows);
            }
          } catch {
            ptyManager.write(data.paneId, message);
          }
        } else if (Buffer.isBuffer(message)) {
          ptyManager.write(data.paneId, message);
        }
      }
      if (data.type === "control") {
        try {
          if (typeof message !== "string") return;
          const msg: ClientMessage = JSON.parse(message);
          handleControlMessage(
            ws as Bun.ServerWebSocket<ControlWsData>,
            msg,
          );
        } catch {
          ws.sendText(
            JSON.stringify({
              type: "error",
              code: "parse_error",
              message: "Invalid JSON",
            }),
          );
        }
      }
    },

    close(ws) {
      const data = ws.data;
      if (data.type === "pty") {
        ptyManager.removeClient(
          data.paneId,
          ws as Bun.ServerWebSocket<PtyWsData>,
        );
      }
      if (data.type === "control") {
        workspaceState.unregisterControlClient(
          ws as Bun.ServerWebSocket<ControlWsData>,
        );
      }
    },

    // Latency: disable per-message compression for PTY channels
    perMessageDeflate: false,
  },
});

console.log(`supaterm-cli listening on http://localhost:${server.port}`);
if (isAuthEnabled()) {
  console.log(`Auth token: ${authToken}`);
}

const spSocket = startSpSocket(workspaceState);

function shutdown() {
  spSocket.server.close();
  workspaceState.destroyAll();
  server.stop();
  process.exit(0);
}

process.on("SIGINT", () => { console.log("\nShutting down..."); shutdown(); });
process.on("SIGTERM", shutdown);
