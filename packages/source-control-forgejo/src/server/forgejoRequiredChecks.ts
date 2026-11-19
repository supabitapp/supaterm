import * as Schema from "effect/Schema";
import type { PullRequestCheck } from "@supaterm/contracts";

export const ForgejoBranchStatusChecks = Schema.Struct({
  enable_status_check: Schema.optional(Schema.Boolean),
  status_check_contexts: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
});

const UNSUPPORTED_GLOB = /[[\]{}\\]/;
const matchesContext = (glob: string, name: string) => {
  const pattern = Array.from(glob);
  const text = Array.from(name);
  let p = 0;
  let t = 0;
  let star = -1;
  let resume = 0;
  while (t < text.length) {
    if (pattern[p] === "*") {
      star = p++;
      resume = t;
    } else if (p < pattern.length && (pattern[p] === "?" || pattern[p] === text[t])) {
      p++;
      t++;
    } else if (star >= 0) {
      p = star + 1;
      t = ++resume;
    } else {
      return false;
    }
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
};

export function markRequiredForgejoChecks(
  checks: ReadonlyArray<PullRequestCheck>,
  branch: typeof ForgejoBranchStatusChecks.Type,
): ReadonlyArray<PullRequestCheck>;
export function markRequiredForgejoChecks(
  checks: ReadonlyArray<PullRequestCheck>,
  branch: typeof ForgejoBranchStatusChecks.Type,
) {
  const contexts = branch.enable_status_check ? (branch.status_check_contexts ?? []) : [];
  if (contexts.length === 0) return checks satisfies ReadonlyArray<PullRequestCheck>;
  const unsupported = [...new Set(contexts.filter((context) => UNSUPPORTED_GLOB.test(context)))];
  if (unsupported.length > 0) {
    return [
      ...checks,
      ...unsupported.map((name) => ({
        name,
        status: "pending" as const,
        description: "Required check pattern cannot be evaluated.",
        url: null,
      })),
    ] satisfies ReadonlyArray<PullRequestCheck>;
  }
  const patterns = [...new Set(contexts)];
  const marked = checks.map((check) =>
    patterns.some((pattern) => matchesContext(pattern, check.name))
      ? { ...check, required: true }
      : check,
  );
  const missing = patterns.flatMap((name) =>
    !name.trim() || checks.some((check) => matchesContext(name, check.name))
      ? []
      : [{ name, status: "pending", description: null, url: null, required: true } as const],
  );
  return [...marked, ...missing] satisfies ReadonlyArray<PullRequestCheck>;
}
