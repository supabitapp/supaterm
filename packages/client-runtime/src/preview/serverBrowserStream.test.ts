import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createPreviewStreamClient,
  resolvePreviewStreamDownload,
  type PreviewStreamControl,
  uploadPreviewStreamFiles,
} from "./serverBrowserStream.ts";

class FakeSocket extends EventTarget {
  static readonly OPEN = 1;
  static current: FakeSocket;
  readyState = 1;
  binaryType = "";
  readonly sent: string[] = [];
  readonly url: string;
  constructor(url: string) {
    super();
    this.url = url;
    FakeSocket.current = this;
  }
  send(value: string) {
    this.sent.push(value);
  }
  close() {
    this.readyState = 3;
  }
  message(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  control(value: PreviewStreamControl) {
    this.message(JSON.stringify({ type: "control", ...value }));
  }
}

const target = {
  access: {
    httpBase: "http://preview.test/api/preview-stream",
    wsBase: "ws://preview.test/api/preview-stream",
    query: {},
    credentials: true,
  },
  threadId: "thread",
  tabId: "tab",
  maxWidth: 800,
  maxHeight: 600,
};

describe("preview stream control", () => {
  beforeEach(() => vi.stubGlobal("WebSocket", FakeSocket));
  afterEach(() => vi.unstubAllGlobals());
  const connect = () => {
    const onFrame = vi.fn();
    const onControl = vi.fn();
    const client = createPreviewStreamClient(target, {
      onFrame,
      onControl,
      onViewport: vi.fn(),
      onConnectedChange: vi.fn(),
      onUnauthorized: vi.fn(),
    });
    return { client, socket: FakeSocket.current, onFrame, onControl };
  };
  const agent: PreviewStreamControl = {
    canOperate: true,
    controller: "agent",
    generation: 1,
    dialog: null,
  };

  it("marks passive viewers without changing active viewer URLs", () => {
    const { client, socket } = connect();
    expect(new URL(socket.url).searchParams.has("interactive")).toBe(false);
    client.stop();
    const passive = createPreviewStreamClient(
      { ...target, interactive: false },
      {
        onFrame: vi.fn(),
        onViewport: vi.fn(),
        onConnectedChange: vi.fn(),
        onUnauthorized: vi.fn(),
      },
    );
    expect(new URL(FakeSocket.current.url).searchParams.get("interactive")).toBe("false");
    passive.stop();
  });

  it("does not resize or navigate before ownership is granted", () => {
    const { client, socket } = connect();
    expect(client.send({ type: "resize", width: 390, height: 844 })).toBe(false);
    expect(client.send({ type: "navigate", url: "http://example.test" })).toBe(false);
    socket.control(agent);
    expect(client.send({ type: "takeControl" })).toBe(true);
    expect(client.send({ type: "text", text: "premature" })).toBe(false);
    socket.control({ ...agent, controller: "you", generation: 2 });
    expect(client.send({ type: "text", text: "owned" })).toBe(true);
    expect(socket.sent.map((entry) => JSON.parse(entry))).toEqual([
      { type: "takeControl" },
      { type: "text", text: "owned" },
    ]);
    client.stop();
  });

  it("does not grant control from malformed dialog metadata", () => {
    const { client, socket, onControl } = connect();
    socket.message(
      JSON.stringify({
        type: "control",
        ...agent,
        controller: "you",
        dialog: { type: "prompt", message: 42, defaultValue: "" },
      }),
    );
    expect(onControl).not.toHaveBeenCalled();
    expect(client.send({ type: "reload" })).toBe(false);
    client.stop();
  });

  it("keeps read-only frames flowing while refusing takeover and every mutation", () => {
    const { client, socket, onFrame } = connect();
    socket.control({ ...agent, canOperate: false });
    const frame = new ArrayBuffer(3);
    socket.message(JSON.stringify({ type: "ping" }));
    socket.message(frame);
    expect(onFrame).toHaveBeenCalledWith(frame);
    expect(client.send({ type: "takeControl" })).toBe(false);
    expect(client.send({ type: "resize", width: 390, height: 844 })).toBe(false);
    expect(client.send({ type: "reload" })).toBe(false);
    expect(socket.sent).toEqual(['{"type":"pong"}', '{"type":"ack"}']);
    client.stop();
  });

  it("repaints a recent frame the server refers back to", () => {
    const { client, socket, onFrame } = connect();
    expect(new URL(socket.url).searchParams.get("repeat")).toBe("1");
    const caretOn = new ArrayBuffer(3);
    const caretOff = new ArrayBuffer(4);
    socket.message(caretOn);
    socket.message(caretOff);
    socket.message(JSON.stringify({ type: "repeat", id: 0 }));
    socket.message(JSON.stringify({ type: "repeat", id: 1 }));
    expect(onFrame.mock.calls.map(([frame]) => frame)).toEqual([
      caretOn,
      caretOff,
      caretOn,
      caretOff,
    ]);
    expect(socket.sent).toEqual(Array(4).fill('{"type":"ack"}'));
    client.stop();
  });

  it("revokes input immediately on release and exposes pending dialog state", () => {
    const { client, socket, onControl } = connect();
    const owned = {
      ...agent,
      controller: "you" as const,
      dialog: { type: "prompt", message: "Name?", defaultValue: "initial" },
    };
    socket.control(owned);
    expect(onControl).toHaveBeenLastCalledWith(owned);
    expect(client.send({ type: "dialog", accept: true, promptText: "answer" })).toBe(true);
    expect(client.send({ type: "releaseControl" })).toBe(true);
    socket.control({ ...agent, generation: 2 });
    expect(client.send({ type: "text", text: "late input" })).toBe(false);
    expect(client.send({ type: "dialog", accept: false })).toBe(false);
    client.stop();
  });
});

describe("preview stream transfers", () => {
  beforeEach(() => vi.stubGlobal("WebSocket", FakeSocket));
  afterEach(() => vi.unstubAllGlobals());

  it("offers a download descriptor without embedding the stream's expiring ticket", () => {
    const onDownload = vi.fn();
    createPreviewStreamClient(
      {
        ...target,
        access: { ...target.access, query: { wsTicket: "ticket" }, credentials: false },
      },
      {
        onFrame: vi.fn(),
        onDownload,
        onViewport: vi.fn(),
        onConnectedChange: vi.fn(),
        onUnauthorized: vi.fn(),
      },
    );
    FakeSocket.current.message(
      JSON.stringify({ type: "download", id: "d1", fileName: "a b.csv", sizeBytes: 3 }),
    );
    expect(onDownload).toHaveBeenCalledExactlyOnceWith({
      id: "d1",
      fileName: "a b.csv",
      sizeBytes: 3,
    });
  });

  it("resolves download URLs with access refreshed at save time", async () => {
    const resolveAccess = vi.fn(async () => ({
      httpBase: "http://preview.test/api/preview-stream",
      wsBase: "ws://preview.test/api/preview-stream",
      query: { wsTicket: "fresh-ticket" },
      credentials: false,
    }));

    await expect(
      resolvePreviewStreamDownload(
        { id: "d1" },
        { threadId: "thread", tabId: "tab", resolveAccess },
      ),
    ).resolves.toBe(
      "http://preview.test/api/preview-stream/download?threadId=thread&tabId=tab&id=d1&wsTicket=fresh-ticket",
    );
    expect(resolveAccess).toHaveBeenCalledOnce();
  });

  it("resolves upload access after the user finishes choosing files", async () => {
    const resolveAccess = vi.fn(async () => ({
      httpBase: "http://preview.test/api/preview-stream",
      wsBase: "ws://preview.test/api/preview-stream",
      query: { wsTicket: "fresh-ticket" },
      credentials: false,
    }));
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await uploadPreviewStreamFiles(
      { id: "chooser-1", multiple: true, accept: ".csv" },
      [new Blob(["file contents"], { type: "text/csv" })],
      { threadId: "thread", tabId: "tab", resolveAccess },
    );

    expect(resolveAccess).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://preview.test/api/preview-stream/upload?threadId=thread&tabId=tab&chooser=chooser-1&wsTicket=fresh-ticket",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "omit",
    });
  });
});

describe("preview stream agent pointer", () => {
  beforeEach(() => vi.stubGlobal("WebSocket", FakeSocket));
  afterEach(() => vi.unstubAllGlobals());

  it("reports where the agent moves and clicks, ignoring malformed points", () => {
    const onPointer = vi.fn();
    createPreviewStreamClient(target, {
      onFrame: vi.fn(),
      onPointer,
      onViewport: vi.fn(),
      onConnectedChange: vi.fn(),
      onUnauthorized: vi.fn(),
    });
    FakeSocket.current.message(
      JSON.stringify({ type: "pointer", phase: "drag", x: 1, y: 2, sequence: 1 }),
    );
    FakeSocket.current.message(
      JSON.stringify({ type: "pointer", phase: "click", x: 140, y: 50, sequence: 2 }),
    );
    expect(onPointer).toHaveBeenCalledExactlyOnceWith({
      phase: "click",
      x: 140,
      y: 50,
      sequence: 2,
    });
  });
});
