// @effect-diagnostics nodeBuiltinImport:off
import * as Schema from "effect/Schema";

const decodeHeaders = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

export const proxyConfig = () => {
  const configured = process.env.SUPATERM_EVAL_BASE_URL;
  if (!configured) throw new Error("Set SUPATERM_EVAL_BASE_URL for the evaluation endpoint.");
  const url = new URL(configured);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("SUPATERM_EVAL_BASE_URL must be an HTTP(S) URL without credentials.");
  }
  const headers = process.env.SUPATERM_EVAL_HEADERS
    ? decodeHeaders(process.env.SUPATERM_EVAL_HEADERS)
    : {};
  if (process.env.SUPATERM_EVAL_API_KEY) {
    headers.Authorization = `Bearer ${process.env.SUPATERM_EVAL_API_KEY}`;
  }
  return { url: url.href.replace(/\/$/, ""), headers };
};
