import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Socket from "effect/socket/Socket";

export const SOCKET_FRAME_PARTS_QUERY_PARAM = "frameParts";

const SOCKET_FRAME_PART_BYTES = 48 * 1024;

const PART_PREFIX = "\u001e";

const PART_RECEIVED_FRAME = '{"_tag":"Pong"}';

/** Splits on the UTF-8 size the frame has on the wire, never inside a surrogate pair. */
export function splitSocketFrame(frame: string, partBytes = SOCKET_FRAME_PART_BYTES) {
  if (frame.length * 3 <= partBytes) return [frame] satisfies Arr.NonEmptyReadonlyArray<string>;
  const parts: Array<string> = [];
  let start = 0;
  let bytes = PART_PREFIX.length;
  for (let index = 0; index < frame.length;) {
    const code = frame.charCodeAt(index);
    const pair = code >= 0xd800 && code <= 0xdbff && index + 1 < frame.length;
    const size = pair ? 4 : code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    if (bytes + size > partBytes) {
      parts.push(PART_PREFIX + frame.slice(start, index));
      start = index;
      bytes = PART_PREFIX.length;
    }
    bytes += size;
    index += pair ? 2 : 1;
  }
  return Arr.append(parts, frame.slice(start)) satisfies Arr.NonEmptyReadonlyArray<string>;
}

/** Server side: sends string frames longer than one part as consecutive parts. */
export function splitLargeSocketFrames(socket: Socket.Socket): Socket.Socket;
export function splitLargeSocketFrames(socket: Socket.Socket) {
  const split: (chunk: string | Uint8Array) => Arr.NonEmptyReadonlyArray<string | Uint8Array> = (
    chunk: string | Uint8Array,
  ) => (typeof chunk === "string" ? splitSocketFrame(chunk) : [chunk]);
  return Socket.make({
    reader: socket.reader,
    writer: Effect.map(socket.writer, (writer) => ({
      write: (chunk) =>
        typeof chunk === "string" ? writer.writeAll(splitSocketFrame(chunk)) : writer.write(chunk),
      writeAll: (chunks) => writer.writeAll(Arr.flatMap(chunks, split)),
    })),
  }) satisfies Socket.Socket;
}

/** Client side: joins parts back into whole frames. */
export function joinSocketFrameParts(socket: Socket.Socket) {
  return Socket.make({
    reader: Effect.map(socket.reader, (reader) => {
      let pending = "";
      const join = (frame: string | Uint8Array) => {
        if (typeof frame !== "string") return frame;
        if (frame.startsWith(PART_PREFIX)) {
          pending += frame.slice(PART_PREFIX.length);
          return PART_RECEIVED_FRAME;
        }
        if (pending === "") return frame;
        const whole = pending + frame;
        pending = "";
        return whole;
      };
      return {
        upgrade: reader.upgrade,
        pull: Effect.map(reader.pull, Arr.map(join)),
      };
    }),
    writer: socket.writer,
  });
}
