import { useEffect, useRef, useState } from "react";
import { useConnectionStore } from "../../stores/connection-store.js";
import { useSettingsStore } from "../../stores/settings-store.js";

const STORAGE_KEY = "supaterm:last-connection";

interface SavedConnection {
  url: string;
  token?: string;
}

function loadSaved(): SavedConnection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveConnection(conn: SavedConnection): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
}

export function useAutoConnect() {
  const status = useConnectionStore((s) => s.status);
  const connect = useConnectionStore((s) => s.connect);
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const paramServer = params.get("server");
    const paramToken = params.get("token");

    if (paramServer) {
      const wsUrl = paramServer.startsWith("ws")
        ? paramServer
        : `ws://${paramServer}`;
      const controlUrl = `${wsUrl.replace(/\/$/, "")}/control`;
      connect(controlUrl, paramToken ?? undefined);
      saveConnection({ url: wsUrl, token: paramToken ?? undefined });
      return;
    }

    // Resolve server URL: injected build-time constant > same-origin
    const serverBase = typeof __SERVER_URL__ === "string" && __SERVER_URL__
      ? __SERVER_URL__
      : `${window.location.protocol}//${window.location.host}`;
    const healthUrl = `${serverBase}/api/health`;

    fetch(healthUrl)
      .then((res) => {
        if (!res.ok) throw new Error("not ok");
        return res.json();
      })
      .then((data: { ok: boolean; token?: string }) => {
        const wsBase = serverBase.replace(/^http/, "ws");
        const controlUrl = `${wsBase}/control`;
        const token = paramToken ?? data.token;
        connect(controlUrl, token ?? undefined);
      })
      .catch(() => {
        useSettingsStore.getState().setConnectionDialogOpen(true);
      });
  }, [connect]);

  return status;
}

export function ConnectionDialog() {
  const isOpen = useSettingsStore((s) => s.isConnectionDialogOpen);
  const close = () => useSettingsStore.getState().setConnectionDialogOpen(false);
  const status = useConnectionStore((s) => s.status);
  const error = useConnectionStore((s) => s.error);
  const connect = useConnectionStore((s) => s.connect);
  const serverUrl = useConnectionStore((s) => s.serverUrl);

  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const saved = loadSaved();
      if (saved) {
        setUrl(saved.url.replace(/^wss?:\/\//, ""));
        setToken(saved.token ?? "");
      }
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    const wsUrl = trimmed.startsWith("ws") ? trimmed : `ws://${trimmed}`;
    const controlUrl = `${wsUrl.replace(/\/$/, "")}/control`;
    connect(controlUrl, token || undefined);
    saveConnection({ url: wsUrl, token: token || undefined });
    const unsub = useConnectionStore.subscribe((state) => {
      if (state.status === "connected") {
        close();
        unsub();
      }
    });
  };

  const isConnecting = status === "connecting";
  const isConnected = status === "connected";
  const currentServer = serverUrl
    ? serverUrl.replace(/^wss?:\/\//, "").replace(/\/control$/, "")
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh]"
      onClick={close}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-2">
          <h2 className="text-base font-semibold text-zinc-100">
            Connect to Remote
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Enter the address of a supaterm-cli server
          </p>
          {isConnected && currentServer && (
            <p className="mt-2 text-xs text-emerald-400">
              Currently connected to {currentServer}
            </p>
          )}
        </div>

        <form onSubmit={handleConnect} className="space-y-3 px-5 pb-2">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              Server
            </label>
            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="host:port (e.g. 192.168.1.50:7681)"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              Auth Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Optional"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1 pb-3">
            <button
              type="button"
              onClick={close}
              className="rounded px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isConnecting || !url.trim()}
              className="rounded bg-zinc-100 px-4 py-1.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
            >
              {isConnecting ? "Connecting..." : "Connect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
