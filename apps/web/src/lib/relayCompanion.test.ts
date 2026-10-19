import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { createRelayCompanionControl } from "./relayCompanion.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

class ControlSocket extends EventTarget {
  static readonly OPEN = 1;
  static instances: ControlSocket[] = [];
  static created = deferred<ControlSocket>();
  readyState = 0;
  readonly sent: Array<{ id: string; action: string; address: string; relayUrl?: string }> = [];
  readonly close = vi.fn(() => {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  });
  constructor() {
    super();
    ControlSocket.instances.push(this);
    ControlSocket.created.resolve(this);
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
    this.dispatchEvent(new Event("sent"));
  }
  nextRequest() {
    return new Promise<(typeof this.sent)[number]>((resolve) =>
      this.addEventListener("sent", () => resolve(this.sent.at(-1)!), { once: true }),
    );
  }
  reply(id: string, origin?: string) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id, origin }) }));
  }
}

const controls: Array<ReturnType<typeof createRelayCompanionControl>> = [];
const identity = (index: number) => {
  const hex = index.toString(16).padStart(64, "0");
  return `https://${hex.slice(0, 32)}.${hex.slice(32)}.relay.supaterm.alt`;
};
async function connectedControl() {
  const control = createRelayCompanionControl();
  controls.push(control);
  const prepared = control.request("open", identity(1));
  const socket = await ControlSocket.created.promise;
  const opening = socket.nextRequest();
  socket.open();
  socket.reply((await opening).id, "http://127.0.0.1:40000");
  await prepared;
  return { control, socket };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", ControlSocket);
  vi.stubGlobal("location", { href: "http://127.0.0.1:5774/" });
  ControlSocket.instances = [];
  ControlSocket.created = deferred<ControlSocket>();
});
afterEach(() => {
  for (const control of controls.splice(0)) control.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps prepared environments connected when an unrelated request times out", async () => {
  const { control, socket } = await connectedControl();
  const stalled = socket.nextRequest();
  const timedOut = expect(control.request("open", identity(2))).rejects.toThrow("did not respond");
  await stalled;
  await vi.advanceTimersByTimeAsync(15_000);
  await timedOut;
  expect(socket.close).not.toHaveBeenCalled();
  expect(await control.request("open", identity(1))).toBe("http://127.0.0.1:40000");
  expect(ControlSocket.instances).toHaveLength(1);
});

it("keeps a late acquisition for the next open instead of reopening", async () => {
  const { control, socket } = await connectedControl();
  const sent = socket.nextRequest();
  const timedOut = expect(control.request("open", identity(2))).rejects.toThrow("did not respond");
  const original = await sent;
  await vi.advanceTimersByTimeAsync(15_000);
  await timedOut;
  socket.reply(original.id, "http://127.0.0.1:40001");
  expect(await control.request("open", identity(2))).toBe("http://127.0.0.1:40001");
  expect(socket.sent.filter((request) => request.address === identity(2))).toHaveLength(1);
});

it("sends close, reopen, and close in call order after the first close times out", async () => {
  const { control, socket } = await connectedControl();
  const initial = socket.nextRequest();
  const timedOut = expect(control.request("close", identity(1))).rejects.toThrow("did not respond");
  const firstClose = await initial;
  await vi.advanceTimersByTimeAsync(15_000);
  await timedOut;
  const reopened = control.request("open", identity(1));
  const removedAgain = control.request("close", identity(1));
  await vi.advanceTimersByTimeAsync(0);
  expect(socket.sent.slice(1).map(({ action }) => action)).toEqual(["close", "open", "close"]);
  socket.reply(firstClose.id);
  socket.reply(socket.sent[2]!.id, "http://127.0.0.1:40100");
  expect(await reopened).toBe("http://127.0.0.1:40100");
  socket.reply(socket.sent[3]!.id);
  await removedAgain;
  expect(await control.request("close", identity(1))).toBeUndefined();
  expect(socket.sent).toHaveLength(4);
});

it("counts unanswered operations toward the limit but still admits closes", async () => {
  const { control, socket } = await connectedControl();
  const requests = Array.from({ length: 64 }, (_, index) =>
    control.request("open", identity(index + 2)).catch((error: Error) => error),
  );
  await vi.advanceTimersByTimeAsync(15_000);
  expect(
    (await Promise.all(requests)).every(
      (error) => error instanceof Error && error.message.includes("did not respond"),
    ),
  ).toBe(true);
  await expect(control.request("open", identity(100))).rejects.toThrow(
    "Too many companion requests",
  );
  expect(await control.request("open", identity(1))).toBe("http://127.0.0.1:40000");
  const closing = socket.nextRequest();
  const released = control.request("close", identity(1));
  socket.reply((await closing).id);
  expect(await released).toBeUndefined();
  socket.reply(socket.sent[1]!.id, "http://127.0.0.1:40002");
  await vi.advanceTimersByTimeAsync(0);
  const opening = socket.nextRequest();
  const fresh = control.request("open", identity(100));
  socket.reply((await opening).id, "http://127.0.0.1:40100");
  expect(await fresh).toBe("http://127.0.0.1:40100");
  expect(socket.close).not.toHaveBeenCalled();
});

it("never reconciles an old socket's reply through a replacement control connection", async () => {
  const { control, socket } = await connectedControl();
  const original = socket.nextRequest();
  const failed = expect(control.request("open", identity(2))).rejects.toThrow("disconnected");
  const oldRequest = await original;
  socket.close();
  await failed;
  ControlSocket.created = deferred<ControlSocket>();
  const retried = control.request("open", identity(2));
  const replacement = await ControlSocket.created.promise;
  const opening = replacement.nextRequest();
  replacement.open();
  const fresh = await opening;
  socket.reply(oldRequest.id, "http://127.0.0.1:40001");
  replacement.reply(fresh.id, "http://127.0.0.1:40004");
  expect(await retried).toBe("http://127.0.0.1:40004");
  expect(replacement.sent).toEqual([fresh]);
});

it("settles pending closes when the companion disconnects and rejects them on dispose", async () => {
  for (const ending of ["disconnect", "dispose"] as const) {
    ControlSocket.created = deferred<ControlSocket>();
    const { control, socket } = await connectedControl();
    const opening = control.request("open", identity(2)).catch((error: Error) => error);
    const released = control.request("close", identity(1)).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(0);
    if (ending === "dispose") control.close();
    else socket.close();
    expect(await opening).toBeInstanceOf(Error);
    if (ending === "dispose")
      expect(await released).toMatchObject({ message: expect.stringContaining("closed") });
    else expect(await released).toBeUndefined();
  }
});

it("forwards a host's relay server with its open request", async () => {
  const { control, socket } = await connectedControl();
  const opening = socket.nextRequest();
  const prepared = control.request("open", identity(2), "wss://relay.example");
  const request = await opening;
  expect(request).toMatchObject({ action: "open", relayUrl: "wss://relay.example" });
  socket.reply(request.id, "http://127.0.0.1:40002");
  expect(await prepared).toBe("http://127.0.0.1:40002");
});

it("orders open, close, and reopen while the control socket is connecting", async () => {
  const control = createRelayCompanionControl();
  controls.push(control);
  const first = control.request("open", identity(1));
  const close = control.request("close", identity(1));
  const reopened = control.request("open", identity(1));
  const socket = await ControlSocket.created.promise;
  socket.open();
  await vi.advanceTimersByTimeAsync(0);
  expect(socket.sent.map(({ action }) => action)).toEqual(["open", "close", "open"]);
  socket.reply(socket.sent[0]!.id, "http://127.0.0.1:40000");
  expect(await first).toBe("http://127.0.0.1:40000");
  socket.reply(socket.sent[1]!.id);
  await close;
  socket.reply(socket.sent[2]!.id, "http://127.0.0.1:40100");
  expect(await reopened).toBe("http://127.0.0.1:40100");
});
