import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { SupatermProjectFile, SUPATERM_PROJECT_FILE_SCHEMA_URL } from "@supaterm/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between the raw `supaterm.json` file contents (lenient JSONC string) and the
 * decoded {@link SupatermProjectFile}.
 */
export const SupatermProjectFileFromJson = fromLenientJson(SupatermProjectFile);

const decodeSupatermProjectFile = Schema.decodeExit(SupatermProjectFileFromJson);

export function parseSupatermProjectFile(contents: string): SupatermProjectFile | null {
  const decoded = decodeSupatermProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

export function buildSupatermProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(SupatermProjectFile, { onExcessProperty: "error" });
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SUPATERM_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
