// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as Schema from "effect/Schema";
import { testRange } from "./grade.ts";

export type Case = {
  readonly id: string;
  readonly kind: "bad" | "guard";
  readonly source: string;
  readonly targets: ReadonlyArray<{ readonly path: string; readonly title: string }>;
};

const decodeWorld = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      diff: Schema.NonEmptyString,
      files: Schema.Record(Schema.String, Schema.String),
    }),
  ),
);

export function caseWorld(entry: Case) {
  const snapshot = decodeWorld(
    NodeFS.readFileSync(new URL(`./fixtures/${entry.id}.json`, import.meta.url), "utf8"),
  );
  const files = new Map(Object.entries(snapshot.files));
  const targets = entry.targets.map((target) => {
    const range = testRange(files.get(target.path) ?? "", target.title);
    if (!range) throw new Error(`${entry.id}: target "${target.title}" not found.`);
    return { path: target.path, ...range };
  });
  return { diff: snapshot.diff, files, targets };
}

export const cases: ReadonlyArray<Case> = [
  {
    id: "copy-text-at-every-call-site",
    kind: "bad",
    source: "#23999 checks the PR or MR label in 11 files",
    targets: [
      {
        path: "packages/client-runtime/src/state/gitActions.test.ts",
        title: "says PR for a GitHub ref",
      },
      {
        path: "packages/client-runtime/src/state/gitActions.test.ts",
        title: "says MR for a GitLab ref",
      },
      {
        path: "packages/client-runtime/src/state/gitActions.test.ts",
        title: "names the host's change request in the default-branch dialog",
      },
      {
        path: "apps/web/src/lib/composerContextRecords.test.ts",
        title: "names the change request the way its host does",
      },
      {
        path: "apps/mobile/src/lib/composerContext.test.ts",
        title: "describes the change request with its host's term",
      },
    ],
  },
  {
    id: "same-case-in-wrapper-test",
    kind: "bad",
    source: "#22452 added the same two cases to threadAccess and OrchestratorMcpService",
    targets: [
      {
        path: "apps/server/src/mcp/threadAccess.test.ts",
        title: "points a bare uuid at the mcp: thread it belongs to",
      },
      {
        path: "apps/server/src/mcp/threadAccess.test.ts",
        title: "keeps the plain message for an id that matches nothing",
      },
      {
        path: "apps/server/src/mcp/OrchestratorMcpService.test.ts",
        title: "points a bare uuid at the mcp: thread it belongs to",
      },
      {
        path: "apps/server/src/mcp/OrchestratorMcpService.test.ts",
        title: "keeps the plain message for an id that matches nothing",
      },
    ],
  },
  {
    id: "new-it-for-a-table-row",
    kind: "bad",
    source: "Synthetic: a new `it` next to the table that already covers it",
    targets: [
      {
        path: "packages/shared/src/markdownLinks.test.ts",
        title: "recognizes a Windows path with forward slashes as a file",
      },
    ],
  },
  {
    id: "mock-call-mirror",
    kind: "bad",
    source: "Synthetic: asserts the mock call the code makes, already covered above it",
    targets: [
      {
        path: "packages/client-runtime/src/state/threadRequests.test.ts",
        title: "calls respond with decline",
      },
    ],
  },
  {
    id: "type-guaranteed",
    kind: "bad",
    source: "Synthetic: checks a return type the signature already declares",
    targets: [
      {
        path: "packages/shared/src/markdownLinks.test.ts",
        title: "returns a boolean",
      },
    ],
  },
  {
    id: "deadlock-race-fix",
    kind: "guard",
    source: "#22094 run metrics read lineage inside the transaction so a writer cannot deadlock",
    targets: [],
  },
  {
    id: "clone-retry-fix",
    kind: "guard",
    source: "#23170 clones retry over HTTPS when the SSH key is refused",
    targets: [],
  },
  {
    id: "deleted-tests",
    kind: "guard",
    source: "#22592 pruned low-value tests",
    targets: [],
  },
  {
    id: "new-table-row",
    kind: "guard",
    source: "Synthetic: the right way to add the Windows path case",
    targets: [],
  },
];
