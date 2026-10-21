import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  buildSupatermProjectFileJsonSchema,
  parseSupatermProjectFile,
  SupatermProjectFileFromJson,
} from "./supatermProjectFile.ts";

const decodeJson = Schema.decodeUnknownSync(SupatermProjectFileFromJson);

describe("buildSupatermProjectFileJsonSchema", () => {
  it("emits a draft 2020-12 schema with the published $id", () => {
    const schema = buildSupatermProjectFileJsonSchema();

    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe("https://supaterm.com/schema/supaterm.json");
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
  });

  it("documents every supported field", () => {
    const schema = buildSupatermProjectFileJsonSchema() as {
      properties: Record<
        string,
        {
          description?: string;
          items?: { properties: Record<string, unknown>; required: ReadonlyArray<string> };
        }
      >;
      required?: ReadonlyArray<string>;
    };

    expect(Object.keys(schema.properties).sort()).toEqual([
      "$schema",
      "defaultThreadEnvMode",
      "iconPath",
      "scripts",
      "worktreeSubmodules",
    ]);
    expect(schema.required).toBeUndefined();
    expect(schema.properties.iconPath?.description).toContain("Workspace-relative path");
    expect(schema.properties.defaultThreadEnvMode?.description).toContain("new threads start");

    const script = schema.properties.scripts?.items;
    expect(script?.required).toEqual(["name", "command"]);
    expect(Object.keys(script?.properties ?? {}).sort()).toEqual([
      "async",
      "autoOpenPreview",
      "command",
      "icon",
      "name",
      "previewUrl",
      "runOnDone",
      "runOnWorktreeCreate",
    ]);
  });

  it("stays JSON-serializable", () => {
    const schema = buildSupatermProjectFileJsonSchema();
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});

describe("SupatermProjectFileFromJson", () => {
  it("decodes lenient JSONC with comments and trailing commas", () => {
    const decoded = decodeJson(`{
      // team scripts
      "iconPath": "assets/logo.svg",
      "scripts": [
        { "name": "Dev", "command": "pnpm dev", },
      ],
    }`);

    expect(decoded.iconPath).toBe("assets/logo.svg");
    expect(decoded.scripts?.[0]).toEqual({ name: "Dev", command: "pnpm dev" });
  });

  it("fails on malformed JSON", () => {
    expect(() => decodeJson("{ not json")).toThrow();
  });
});

describe("parseSupatermProjectFile", () => {
  it("reads project defaults from JSONC with a URL in a block comment", () => {
    expect(
      parseSupatermProjectFile(`{
        /* See https://supaterm.sh/schema/supaterm.json */
        "defaultThreadEnvMode": "worktree"
      }`),
    ).toEqual({ defaultThreadEnvMode: "worktree" });
  });

  it("returns null for malformed or invalid contents", () => {
    expect(parseSupatermProjectFile("{ not json")).toBeNull();
    expect(parseSupatermProjectFile('{ "defaultThreadEnvMode": "spaceship" }')).toBeNull();
  });
});
