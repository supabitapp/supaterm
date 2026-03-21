import { create } from "zustand";
import type { ClientMessage, ServerMessage } from "@supaterm/shared";
import { useWorkspaceStore } from "./workspace-store.js";

interface ConnectionStore {
  serverUrl: string | null;
  token: string | null;
  status: "disconnected" | "connecting" | "connected" | "reconnecting";
  controlWs: WebSocket | null;
  error: string | null;

  connect: (url: string, token?: string) => void;
  disconnect: () => void;
  send: (msg: ClientMessage) => void;
}

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 100;

function appendToken(url: string, token: string | null): string {
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  serverUrl: null,
  token: null,
  status: "disconnected",
  controlWs: null,
  error: null,

  connect(url: string, token?: string) {
    const current = get();

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // Detach handlers before closing to prevent reconnect cascade
    if (current.controlWs) {
      current.controlWs.onclose = null;
      current.controlWs.onerror = null;
      current.controlWs.onmessage = null;
      current.controlWs.close();
    }

    const tok = token ?? current.token;
    set({ serverUrl: url, token: tok ?? null, status: "connecting", error: null });

    const ws = new WebSocket(appendToken(url, tok ?? null));

    ws.onopen = () => {
      set({ status: "connected", controlWs: ws, error: null });
      reconnectDelay = 100;
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        useWorkspaceStore.getState().handleServerMessage(msg);
      } catch {}
    };

    ws.onclose = () => {
      const { controlWs: activeWs } = get();
      if (activeWs !== ws) return;

      set({ status: "reconnecting", controlWs: null });
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 5000);
        const { serverUrl, token: t } = get();
        if (serverUrl) get().connect(serverUrl, t ?? undefined);
      }, reconnectDelay);
    };

    ws.onerror = () => {
      set({ error: "Connection error" });
    };
  },

  disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const { controlWs } = get();
    if (controlWs) controlWs.close();
    set({ status: "disconnected", controlWs: null, serverUrl: null });
  },

  send(msg: ClientMessage) {
    const { controlWs } = get();
    if (controlWs?.readyState === WebSocket.OPEN) {
      controlWs.send(JSON.stringify(msg));
    }
  },
}));

