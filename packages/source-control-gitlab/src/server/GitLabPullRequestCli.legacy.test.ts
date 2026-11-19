import { afterEach, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/process";
import { VcsProcessExitError } from "@supaterm/contracts";

import type * as SourceControlHost from "@supaterm/source-control-core/server/SourceControlHost";
import * as TestSourceControlHost from "@supaterm/source-control-testing/TestSourceControlHost";
import * as GitLabCli from "./GitLabCli.ts";
import * as GitLabPullRequestCli from "./GitLabPullRequestCli.ts";
import { scriptedFunction } from "@supaterm/source-control-testing/scriptedFunction";

const run = scriptedFunction<SourceControlHost.SourceControlHost["Service"]["process"]["run"]>();
const layer = it.layer(
  GitLabPullRequestCli.layer.pipe(
    Layer.provide(GitLabCli.layer),
    Layer.provide(TestSourceControlHost.layer({ process: { run } })),
    Layer.provide(FileSystem.layerNoop({})),
  ),
);
const input = { cwd: "/repo", repository: "acme/nested/web", number: 7 };
const file = {
  old_path: "src/old.ts",
  new_path: "src/new.ts",
  renamed_file: true,
  new_file: false,
  deleted_file: false,
  a_mode: "100644",
  b_mode: "100644",
  diff: "@@ -1 +1 @@\n-before\n+after\n",
};

function output(body: unknown, stdoutTruncated = false) {
  return Effect.succeed({
    exitCode: ChildProcessSpawner.ExitCode(0),
    stdout: JSON.stringify(body),
    stderr: "",
    stdoutTruncated,
    stderrTruncated: false,
  });
}

function failure(failureKind: "not-found" | "authentication" | "rate-limited" | "command-failed") {
  return Effect.fail(
    new VcsProcessExitError({
      operation: "GitLabCli.execute",
      command: "glab",
      cwd: input.cwd,
      exitCode: 1,
      detail: "GitLab HTTP failure",
      failureKind,
    }),
  );
}
afterEach(() => run.reset());

layer("legacy GitLab diff requests through GitLabCli", (it) => {
  it.effect.each([0, 1, 100, 247])("returns %s legacy changes as one terminal slice", (count) =>
    Effect.gen(function* () {
      run.returnsOnce(failure("not-found"));
      run.returnsOnce(
        output({
          changes: Array.from({ length: count }, () => file),
          overflow: false,
          changes_count: String(count),
        }),
      );
      const cli = yield* GitLabPullRequestCli.GitLabPullRequestCli;
      const result = yield* cli.getMergeRequestDiff(input);
      expect(result.nextCursor).toBeNull();
      expect(result.truncated).toBe(false);
      expect(result.patch.match(/^diff --git /gm)?.length ?? 0).toBe(count);
      if (count > 0) {
        expect(result.patch).toContain("rename from src/old.ts\nrename to src/new.ts");
        expect(result.patch).toContain("@@ -1 +1 @@\n-before\n+after\n");
        expect(result.patch.endsWith("\n")).toBe(true);
      }
      expect(run.calls.map(([call]) => call.args)).toEqual([
        ["api", "projects/acme%2Fnested%2Fweb/merge_requests/7/diffs?per_page=30&page=1"],
        ["api", "projects/acme%2Fnested%2Fweb/merge_requests/7/changes?access_raw_diffs=true"],
      ]);
      expect(run.calls[1]?.[0]).toMatchObject({
        cwd: "/repo",
        maxOutputBytes: 8 * 1024 * 1024,
        timeoutMs: 60_000,
      });
    }),
  );
  it.effect.each([false, true])("accepts an unavailable legacy count (overflow: %s)", (overflow) =>
    Effect.gen(function* () {
      run.returnsOnce(failure("not-found"));
      run.returnsOnce(output({ changes: [file], changes_count: null, overflow }));
      const cli = yield* GitLabPullRequestCli.GitLabPullRequestCli;
      const result = yield* cli.getMergeRequestDiff(input);
      expect(result.truncated).toBe(overflow);
      expect(result.nextCursor).toBeNull();
      expect(result.patch).toContain("@@ -1 +1 @@\n-before\n+after\n");
    }),
  );
  it.effect.each([{ overflow: true }, { changes_count: "247+" }])(
    "marks legacy limits %j truncated",
    (metadata) =>
      Effect.gen(function* () {
        run.returnsOnce(failure("not-found"));
        run.returnsOnce(output({ changes: [file], ...metadata }));
        const cli = yield* GitLabPullRequestCli.GitLabPullRequestCli;
        expect(yield* cli.getMergeRequestDiff(input)).toMatchObject({
          truncated: true,
          nextCursor: null,
        });
      }),
  );
  it.effect.each([false, true])("marks skipped file entries truncated (legacy: %s)", (legacy) =>
    Effect.gen(function* () {
      const entries = [file, { new_path: "missing-old-path.ts" }];
      if (legacy) run.returnsOnce(failure("not-found"));
      run.returnsOnce(output(legacy ? { changes: entries } : entries));
      const cli = yield* GitLabPullRequestCli.GitLabPullRequestCli;
      const result = yield* cli.getMergeRequestDiff(input);
      expect(result.truncated).toBe(true);
      expect(result.nextCursor).toBeNull();
      expect(result.patch.match(/^diff --git /gm)).toHaveLength(1);
      expect(result.patch).toContain("@@ -1 +1 @@\n-before\n+after\n");
    }),
  );
  it.effect("rejects a byte-truncated legacy response", () =>
    Effect.gen(function* () {
      run.returnsOnce(failure("not-found"));
      run.returnsOnce(output({ changes: [file] }, true));
      const cli = yield* GitLabPullRequestCli.GitLabPullRequestCli;
      expect((yield* cli.getMergeRequestDiff(input).pipe(Effect.flip))._tag).toBe(
        "GitLabMergeRequestReadError",
      );
    }),
  );
  it.effect.each(["authentication", "rate-limited", "command-failed"] as const)(
    "does not fall back on %s",
    (kind) =>
      Effect.gen(function* () {
        run.returnsOnce(failure(kind));
        const cli = yield* GitLabPullRequestCli.GitLabPullRequestCli;
        yield* cli.getMergeRequestDiff(input).pipe(Effect.flip);
        expect(run.calls).toHaveLength(1);
      }),
  );
  it.effect("does not fall back for a missing commit or later MR page", () =>
    Effect.gen(function* () {
      const cli = yield* GitLabPullRequestCli.GitLabPullRequestCli;
      for (const target of [
        { ...input, commit: "abc1234" },
        { ...input, cursor: "2" },
      ]) {
        run.returnsOnce(failure("not-found"));
        yield* cli.getMergeRequestDiff(target).pipe(Effect.flip);
      }
      expect(run.calls).toHaveLength(2);
    }),
  );
  it.effect("propagates failure of the legacy endpoint", () =>
    Effect.gen(function* () {
      run.returnsOnce(failure("not-found"));
      run.returnsOnce(failure("not-found"));
      const cli = yield* GitLabPullRequestCli.GitLabPullRequestCli;
      expect((yield* cli.getMergeRequestDiff(input).pipe(Effect.flip))._tag).toBe(
        "GitLabCliCommandError",
      );
      expect(run.calls).toHaveLength(2);
    }),
  );
  it.effect("does not fall back on an unreadable successful modern response", () =>
    Effect.gen(function* () {
      run.returnsOnce(output({ changes: [file] }));
      const cli = yield* GitLabPullRequestCli.GitLabPullRequestCli;
      expect((yield* cli.getMergeRequestDiff(input).pipe(Effect.flip))._tag).toBe(
        "GitLabMergeRequestReadError",
      );
      expect(run.calls).toHaveLength(1);
    }),
  );
  it.effect("keeps modern pagination without requesting legacy changes", () =>
    Effect.gen(function* () {
      run.returnsOnce(output(Array.from({ length: 30 }, () => file)));
      run.returnsOnce(output([file]));
      const cli = yield* GitLabPullRequestCli.GitLabPullRequestCli;
      const first = yield* cli.getMergeRequestDiff(input);
      expect(first.nextCursor).toBe("2");
      expect(
        (yield* cli.getMergeRequestDiff({ ...input, cursor: first.nextCursor! })).nextCursor,
      ).toBeNull();
      expect(run.calls).toHaveLength(2);
      expect(run.calls[1]?.[0].args).toContain(
        "projects/acme%2Fnested%2Fweb/merge_requests/7/diffs?per_page=30&page=2",
      );
    }),
  );
});
