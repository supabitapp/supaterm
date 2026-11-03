import { CODEX_MICRO_AGENT_KEYS } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { CodexMicroConnection } from "./transport.ts";

const KEYMAP_FILE = "keymap.json";
const FILE_LIST_METHOD = "fs.list";
const FILE_READ_METHOD = "fs.readbin";
const READ_CHUNK_BYTES = 1024;
const MAX_KEYMAP_BYTES = 512 * 1024;

const isKeymapEntry = Schema.is(
  Schema.Struct({
    name: Schema.Literal(KEYMAP_FILE),
    size: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_KEYMAP_BYTES })),
    checksum: Schema.String,
  }),
);
const decodeFileList = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));
const decodeFileChunk = Schema.decodeUnknownOption(Schema.Struct({ data: Schema.String }));
const decodeKeymap = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      profiles: Schema.Array(
        Schema.Struct({
          layers: Schema.Array(
            Schema.Struct({
              layout: Schema.Struct({ keymap: Schema.Array(Schema.Array(Schema.String)) }),
            }),
          ),
        }),
      ),
    }),
  ),
);

export interface CodexMicroKeymap {
  readonly checksum: string;
  /** Agent keys mapped on any layer; null when the keymap's shape is not one we know. */
  readonly mappedAgentKeys: number | null;
}

// The firmware lights and reports a key as agent key N only where a layer maps it to KV_OAI_AG{N}.
function countMappedAgentKeys(text: string): number | null {
  const keymap = decodeKeymap(text);
  if (Option.isNone(keymap)) return null;
  const keycodes = new Set(
    keymap.value.profiles.flatMap((profile) =>
      profile.layers.flatMap((layer) => layer.layout.keymap.flat()),
    ),
  );
  return CODEX_MICRO_AGENT_KEYS.filter((key) => keycodes.has(`KV_OAI_${key}`)).length;
}

/**
 * Reads keymap.json when its checksum differs from `previous`. Undefined means the
 * keyboard could not say, so the caller keeps what it had and asks again later.
 */
export const refreshKeymap = Effect.fn("desktop.codexMicro.keymap.refresh")(
  function* (request: CodexMicroConnection["request"], previous: CodexMicroKeymap | undefined) {
    const files = decodeFileList(yield* request(FILE_LIST_METHOD, { checksum: true }));
    const entry = Option.getOrUndefined(files)?.find(isKeymapEntry);
    if (entry === undefined) return undefined;
    if (entry.checksum === previous?.checksum) return previous;

    const bytes = new Uint8Array(entry.size);
    let offset = 0;
    while (offset < entry.size) {
      const chunk = decodeFileChunk(
        yield* request(FILE_READ_METHOD, {
          file: KEYMAP_FILE,
          offset,
          len: Math.min(READ_CHUNK_BYTES, entry.size - offset),
        }),
      );
      if (Option.isNone(chunk)) return undefined;
      const data = Buffer.from(chunk.value.data, "base64");
      if (data.length === 0 || offset + data.length > entry.size) return undefined;
      bytes.set(data, offset);
      offset += data.length;
    }
    return {
      checksum: entry.checksum,
      mappedAgentKeys: countMappedAgentKeys(new TextDecoder().decode(bytes)),
    };
  },
  Effect.orElseSucceed(() => undefined),
);
