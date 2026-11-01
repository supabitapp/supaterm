import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { Tool } from "effect/ai";

import { advertisedJsonSchema } from "./advertisedJsonSchema.ts";
import { HtmlToolkit } from "./toolkits/html/tools.ts";

it("drops JSON noise, merges tagged unions, and keeps null where it is required", () => {
  const Every = Schema.Struct({ ms: Schema.Int });
  const tool = Tool.make("example", {
    parameters: Schema.Struct({
      threadId: Schema.optional(Schema.NullOr(Schema.String)),
      beforeRunId: Schema.NullOr(Schema.String),
      limit: Schema.optional(Schema.Int),
      every: Schema.Union([Every, Schema.fromJsonString(Every)]),
      target: Schema.optional(
        Schema.NullOr(
          Schema.Union([
            Schema.Struct({ kind: Schema.Literal("url"), url: Schema.String }),
            Schema.Struct({ kind: Schema.Literal("number"), number: Schema.Int }),
          ]),
        ),
      ),
    }),
  });

  expect(advertisedJsonSchema(tool)).toEqual({
    type: "object",
    properties: {
      threadId: { type: "string" },
      beforeRunId: { anyOf: [{ type: "string" }, { type: "null" }] },
      limit: { type: "integer" },
      every: { type: "object", properties: { ms: { type: "integer" } }, required: ["ms"] },
      target: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["url", "number"] },
          url: { type: "string" },
          number: { type: "integer" },
        },
        required: ["kind"],
      },
    },
    required: ["beforeRunId", "every"],
  });
});

it("keeps each html_render spec component's own props apart", () => {
  const schema = advertisedJsonSchema(HtmlToolkit.tools.html_render) as {
    readonly required: ReadonlyArray<string>;
    readonly properties: {
      readonly spec: {
        readonly properties: {
          readonly elements: {
            readonly additionalProperties: {
              readonly oneOf: ReadonlyArray<{
                readonly properties: {
                  readonly type: { readonly enum: ReadonlyArray<string> };
                  readonly props: { readonly required?: ReadonlyArray<string> };
                };
                readonly required: ReadonlyArray<string>;
              }>;
            };
          };
        };
      };
    };
  };

  expect(schema.required).toEqual(["title", "height"]);
  expect(
    schema.properties.spec.properties.elements.additionalProperties.oneOf.map((branch) => [
      branch.properties.type.enum,
      branch.properties.props.required ?? [],
      branch.required,
    ]),
  ).toEqual([
    [["Stack"], [], ["type", "props", "children"]],
    [["Columns"], [], ["type", "props", "children"]],
    [["Text"], ["text"], ["type", "props"]],
    [["Table"], ["headers", "rows"], ["type", "props"]],
    [["BarChart"], ["data"], ["type", "props"]],
    [["LineChart"], ["data"], ["type", "props"]],
    [["Image"], ["src", "alt"], ["type", "props"]],
  ]);
});
