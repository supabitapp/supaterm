import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ModelSelection } from "./modelSelection.ts";

const decodeModelSelection = Schema.decodeUnknownEffect(ModelSelection);
const encodeModelSelection = Schema.encodeUnknownEffect(ModelSelection);

it.effect("ModelSelection round-trips the instanceId wire form", () =>
  Effect.gen(function* () {
    const wire = {
      instanceId: "ollama",
      model: "llama3:70b",
      options: [{ id: "temperature", value: "0.4" }],
    };
    const encoded = yield* encodeModelSelection(yield* decodeModelSelection(wire));
    assert.deepStrictEqual(encoded, wire);
  }),
);
