import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

type JsonObject = { [key: string]: unknown };

const isIdKey = (key: string) => key === "id" || key.endsWith("Id");
const isIdListKey = (key: string) => key.endsWith("Ids");

function internRecordIds(container: JsonObject, ids: Array<string | number>): JsonObject {
  const index = new Map<string | number, number>();
  const ref = (value: unknown) => {
    if (typeof value !== "string" && typeof value !== "number") return value;
    let position = index.get(value);
    if (position === undefined) {
      position = ids.length;
      ids.push(value);
      index.set(value, position);
    }
    return position;
  };

  const internRecord = (record: JsonObject): JsonObject => {
    const out: JsonObject = {};
    for (const key in record) {
      const value = record[key];
      out[key] = isIdKey(key)
        ? ref(value)
        : isIdListKey(key) && Array.isArray(value)
          ? value.map(ref)
          : key === "item" && Predicate.isObject(value)
            ? internRecord(value)
            : value;
    }
    return out;
  };
  const out: JsonObject = {};
  for (const key in container) {
    const value = container[key];
    out[key] = Array.isArray(value)
      ? value.map((record) => (Predicate.isObject(record) ? internRecord(record) : record))
      : Predicate.isObject(value)
        ? internRecord(value)
        : value;
  }
  return out;
}

function expandRecordIds(container: JsonObject, ids: ReadonlyArray<unknown>): void {
  const expandRecord = (record: JsonObject) => {
    for (const key in record) {
      const value = record[key];
      if (typeof value === "number") {
        if (isIdKey(key)) record[key] = ids[value];
      } else if (Array.isArray(value)) {
        if (isIdListKey(key)) {
          for (let i = 0; i < value.length; i++) {
            const entry = value[i];
            if (typeof entry === "number") value[i] = ids[entry];
          }
        }
      } else if (key === "item" && Predicate.isObject(value)) {
        expandRecord(value);
      }
    }
  };
  for (const key in container) {
    const value = container[key];
    if (Array.isArray(value)) {
      for (const record of value) if (Predicate.isObject(record)) expandRecord(record);
    } else if (Predicate.isObject(value)) {
      expandRecord(value);
    }
  }
}

const ParsedJson = Schema.declare(Predicate.isUnknown, {
  toCodecJson: () => undefined,
});

export const withRecordIdTable = <S extends Schema.Top>(
  schema: S,
  container: (value: JsonObject) => string | null | undefined,
) => {
  const codec = Schema.toCodecJson(schema);
  type Encoded = typeof codec.Encoded;
  return ParsedJson.pipe(
    Schema.decodeTo(codec, {
      decode: SchemaGetter.transform((raw: unknown): Encoded => {
        if (!Predicate.isObject(raw) || !Array.isArray(raw.ids)) return raw as Encoded;

        const ids: ReadonlyArray<unknown> = raw.ids;
        delete raw.ids;
        const key = container(raw);
        const target = key === null ? raw : key === undefined ? undefined : raw[key];
        if (Predicate.isObject(target)) expandRecordIds(target, ids);
        return raw as Encoded;
      }),
      encode: SchemaGetter.transform((encoded: Encoded): unknown => {
        if (!Predicate.isObject(encoded) || encoded.idTable !== true) return encoded;
        const record: JsonObject = encoded;
        const { idTable: _idTable, ...rest } = record;
        const key = container(rest);
        const ids: Array<string | number> = [];
        if (key === null) return { ...internRecordIds(rest, ids), ids };
        const target = key === undefined ? undefined : rest[key];
        if (key === undefined || !Predicate.isObject(target)) return rest;
        return { ...rest, [key]: internRecordIds(target, ids), ids };
      }),
    }),
  );
};
