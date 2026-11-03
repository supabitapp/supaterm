import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  LiveDictation,
  type LiveDictationSocket,
  type LiveDictationSocketEvents,
} from "./liveDictation.ts";

interface FakeSocket extends LiveDictationSocket {
  readonly sent: Array<string | Uint8Array>;
  readonly events: LiveDictationSocketEvents;
  closedWith: number | null;
}

const frame = (fill: number, bytes = 3_200) => new Uint8Array(bytes).fill(fill);

function setup(
  prepare: () => Promise<string> = async () => "ws://env/api/transcription/streams/t",
) {
  const sockets: Array<FakeSocket> = [];
  let opened: (socket: FakeSocket) => void = () => undefined;
  const firstSocket = new Promise<FakeSocket>((resolve) => {
    opened = resolve;
  });
  let push: (pcm: Uint8Array) => void = () => undefined;
  let subscribed = false;
  const live = new LiveDictation({
    prepare,
    openSocket: (_url, events) => {
      const socket: FakeSocket = {
        bufferedAmount: 0,
        sent: [],
        events,
        closedWith: null,
        send: (data) => socket.sent.push(typeof data === "string" ? data : new Uint8Array(data)),
        close: (code) => {
          socket.closedWith = code ?? 1000;
        },
      };
      sockets.push(socket);
      opened(socket);
      return socket;
    },
    subscribe: (listener) => {
      push = listener;
      subscribed = true;
      return () => {
        subscribed = false;
      };
    },
  });
  return {
    live,
    sockets,
    firstSocket,
    record: (frame: Uint8Array) => push(frame),
    subscribed: () => subscribed,
    ready: (socket: FakeSocket, receivedBytes: number) =>
      socket.events.message(JSON.stringify({ type: "ready", receivedBytes })),
  };
}

describe("LiveDictation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends what was recorded before the stream opened, then finishes once the server has it all", async () => {
    const dictation = setup();
    dictation.record(frame(1));
    dictation.record(frame(2));
    const socket = await dictation.firstSocket;
    expect(socket.sent).toEqual([]);

    dictation.ready(socket, 0);
    dictation.record(frame(3, 1_000));
    expect(socket.sent).toEqual([frame(1), frame(2), frame(3, 1_000)]);

    const finished = dictation.live.finish();
    expect(dictation.subscribed()).toBe(false);
    expect(socket.sent.at(-1)).toBe('{"type":"finish"}');
    socket.events.message('{"type":"finished"}');
    expect(await finished).toBe(true);
    expect(socket.closedWith).toBe(1000);
  });

  it("resumes a dropped stream from the audio the server already holds", async () => {
    vi.useFakeTimers();
    const dictation = setup();
    const first = await dictation.firstSocket;
    dictation.ready(first, 0);
    dictation.record(frame(1));
    dictation.record(frame(2));
    first.events.close(1006);
    dictation.record(frame(3));

    vi.advanceTimersByTime(250);
    const second = dictation.sockets[1]!;
    dictation.ready(second, 3_200);
    expect(second.sent).toEqual([frame(2), frame(3)]);
    const finished = dictation.live.finish();
    second.events.message('{"type":"finished"}');
    expect(await finished).toBe(true);
  });

  it("leaves the recording to the upload when the server turns the stream away", async () => {
    const refused = setup();
    (await refused.firstSocket).events.close(4001);
    expect(await refused.live.finish()).toBe(false);
    expect(refused.sockets).toHaveLength(1);

    const unprepared = setup(() => Promise.reject(new Error("old server")));
    expect(await unprepared.live.finish()).toBe(false);

    const unopenable = new LiveDictation({
      prepare: async () => "ws://env/stream",
      openSocket: () => {
        throw new SyntaxError("blocked");
      },
      subscribe: () => () => undefined,
    });
    expect(await unopenable.finish()).toBe(false);
  });
});
