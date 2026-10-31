#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

// Release notes cover web, desktop, and server. Mobile ships through the app stores on its own schedule.
const MOBILE_SCOPES = new Set(["mobile", "android", "ios"]);
const COMMIT_SCOPES = /^[a-z]+\(([^)]*)\)!?:/i;
const PULL_REQUEST_NUMBER = /\(#(\d+)\)$/;
const MERGE_COMMIT_SUBJECT = /^Merge pull request #(\d+) from \S+$/;
const PULL_REQUEST_BODY_LIMIT = 300;
const SUMMARY_MODEL = "claude-opus-5-5";
// The Claude balancer serves Opus only to requests whose system prompt opens with this line.
const BALANCER_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

const SUMMARY_INSTRUCTIONS = `You write release notes for Supaterm, a GUI for coding agents (web and desktop apps backed by a server; providers like Codex, Claude, Cursor, Grok, OpenCode, Antigravity).

These notes cover the web app, desktop app, and server only. The mobile app ships through the app stores on its own schedule, so leave out anything only about mobile, iOS, or Android.

You get the commit subjects merged since the last release, oldest first. Most end with a PR number like (#1234). Each commit shows lines added and removed and files changed, then a trimmed PR description on the next line starting with ">". Use the descriptions to understand what changed for users and why it matters. Line counts hint at size, but a small change can still matter most.

Output Markdown in exactly this shape and nothing else:

## Highlights
Up to 4 short sentences. Name only the new features a user would care about most. If no new feature matters to users, write one sentence about the most important fix. Each feature gets a few words that make the benefit clear, not a description of how it works or where the button is.

## Fixes
- Up to 10 bullets, one fix each, under 10 words, ending with the PR number like (#123). Fewer is fine. Never pad.
- Each bullet names what was broken and says it works now. A user who hit the bug should recognize it.
- Only list fixes from fix commits. New abilities go in Highlights or nowhere. Say "again" only if the commit says it.

How to write:
- Pick only significant, user-facing changes. Leave out visual polish (focus rings, spacing, colors), layout tweaks, refactors, tests, CI, build, docs, deps, internal tooling, and performance or efficiency work a user would not feel.
- Include Labs and beta features, with "(beta)" after the feature. Leave out work marked internal testing or dev-only.
- Describe each feature as it is at the end of the range. If a beta feature became standard later in the range, it is not beta.
- Say what the user gets, as short as possible. Cut details, conditions, and mechanics.
- No defaults or rollout state ("on by default", "now available", "behind a flag").
- For lists of file types or formats, use common extensions: "previews for .docx, .ttf, .sqlite, .zip and more".
- No internal names, env vars, file paths, or code terms.
- No em dashes. No hype words. Do not invent anything that is not in the input.

Examples of the tone:
- Bad: "Cmd+K now finds the right thread first, and it searches message text too." Good: "Much better Cmd+K search."
- Bad: "You can share a thread with a guest who watches it live and sends messages that you approve." Good: "Share threads with guests, safely."
- Bad: "Triage issues from the command palette." Good: "Fix and debug Supaterm itself with a new 'triage' command."
- Bad: "Settings and Usage open as large modals over your thread." Good: leave it out.
- Bad: "Cmd/Ctrl+W closes tabs safely (#25860)" Good: "Cmd/Ctrl+W no longer closes the whole window (#25860)"`;

class EmptyReleaseRangeError extends Schema.TaggedError<EmptyReleaseRangeError>()(
  "EmptyReleaseRangeError",
  { range: Schema.String },
) {}

class CommandFailedError extends Schema.TaggedError<CommandFailedError>()("CommandFailedError", {
  command: Schema.String,
  exitCode: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
}) {
  override get message(): string {
    return `${this.command} exited with code ${this.exitCode}: ${this.stderr.trim()}`;
  }
}

interface ReleaseCommit {
  readonly subject: string;
  /** Absent on merge commits, whose git author only merged the PR. */
  readonly authorName?: string;
}

const PullRequest = Schema.Struct({
  body: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  changedFiles: Schema.Number,
  author: Schema.NullOr(
    Schema.Struct({
      __typename: Schema.String,
      login: Schema.String,
      name: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});
export type PullRequest = typeof PullRequest.Type;

const PullRequestQueryResponse = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Record(Schema.String, Schema.NullOr(PullRequest)),
  }),
});

const GeneratedNotes = Schema.Struct({ body: Schema.String });

const SummaryResponse = Schema.Struct({
  stop_reason: Schema.NullOr(Schema.String),
  content: Schema.Array(
    Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }),
  ),
  usage: Schema.optional(
    Schema.Struct({ input_tokens: Schema.Number, output_tokens: Schema.Number }),
  ),
});

const pullRequestNumber = (subject: string) => {
  const match = PULL_REQUEST_NUMBER.exec(subject);
  return match ? Number(match[1]) : undefined;
};

/**
 * Reads `git log --first-parent --format=%s%x1f%an%x1f%b%x1e`. A merge commit's subject only names
 * the branch, so it becomes the PR title from its body with the number appended, like a squash.
 */
export function parseReleaseCommits(log: string): ReadonlyArray<ReleaseCommit> {
  return log.split("\x1e").flatMap((record) => {
    const [subject = "", authorName = "", body = ""] = record.replace(/^\n/, "").split("\x1f");
    if (subject === "") return [];
    const number = MERGE_COMMIT_SUBJECT.exec(subject)?.[1];
    const title = body.trim().split("\n")[0]?.trim();
    if (number && title) return [{ subject: `${title} (#${number})` }];
    return [{ subject, authorName }];
  });
}

/** Drops a commit only when every scope is mobile, so `fix(web,mobile)` stays. */
export function isReleaseNoteCommit(commit: ReleaseCommit): boolean {
  const scopes = COMMIT_SCOPES.exec(commit.subject)?.[1]?.split(",");
  return !scopes?.every((scope) => MOBILE_SCOPES.has(scope.trim().toLowerCase()));
}

/** Keeps the prose of a PR body: no images, tables, headings, HTML, or verification sections. */
function trimPullRequestBody(body: string, limit = PULL_REQUEST_BODY_LIMIT): string {
  const [prose = ""] = body.split(/\n#+\s*(?:Verification|Council|Test|Testing|Screenshots)\b/i);
  const text = prose
    .split("\n")
    .filter((line) => line.trim() !== "" && !/^\s*[!|#<]/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function buildSummaryInput(
  commits: ReadonlyArray<ReleaseCommit>,
  pullRequests: ReadonlyMap<number, PullRequest>,
): string {
  return commits
    .flatMap(({ subject }) => {
      const number = pullRequestNumber(subject);
      const pullRequest = number === undefined ? undefined : pullRequests.get(number);
      if (!pullRequest) return [subject];
      const line = `${subject} [+${pullRequest.additions} -${pullRequest.deletions}, ${pullRequest.changedFiles} files]`;
      const body = trimPullRequestBody(pullRequest.body);
      return body ? [line, `  > ${body}`] : [line];
    })
    .join("\n");
}

/** PR authors without bots, plus authors of direct pushes who have no PR in the range. */
export function countContributors(
  commits: ReadonlyArray<ReleaseCommit>,
  pullRequests: ReadonlyMap<number, PullRequest>,
): number {
  const people = new Set<string>();
  // A PR's commit carries a git name, which may differ from the author's profile name.
  const prAuthorNames = new Set<string>();
  const directAuthors: string[] = [];
  for (const commit of commits) {
    const number = pullRequestNumber(commit.subject);
    const author = number === undefined ? undefined : pullRequests.get(number)?.author;
    if (!author) {
      if (commit.authorName) directAuthors.push(commit.authorName);
      continue;
    }
    if (author.__typename === "Bot" || author.login.endsWith("[bot]")) continue;
    people.add(author.login);
    if (commit.authorName) prAuthorNames.add(commit.authorName);
    if (author.name) prAuthorNames.add(author.name);
  }
  for (const name of directAuthors) {
    if (!name.endsWith("[bot]") && !prAuthorNames.has(name)) people.add(name);
  }
  return people.size;
}

/** No date here: the app shows how long ago a release shipped, and GitHub shows the date. */
function buildReleaseHeader(version: string, changes: number, contributors: number): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return `**v${version.replace(/^v/, "")}** · ${plural(changes, "change")} from ${plural(contributors, "contributor")}`;
}

/** The summary leads; GitHub's full list folds under it. Clients cut the body at `<details>`. */
function assembleReleaseNotes(header: string, summary: string, fullChangelog: string): string {
  return `${header}\n\n${summary.trim()}\n\n<details>\n<summary>Full changelog</summary>\n\n${fullChangelog.trim()}\n\n</details>\n`;
}

const run = Effect.fn("generateReleaseNotes.run")(function* (
  command: string,
  args: ReadonlyArray<string>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(command, args));
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      Stream.mkString(Stream.decodeText(child.stdout)),
      Stream.mkString(Stream.decodeText(child.stderr)),
      Effect.map(child.exitCode, Number),
    ],
    { concurrency: "unbounded" },
  );
  if (exitCode !== 0) {
    return yield* new CommandFailedError({ command, exitCode, stdout, stderr });
  }
  return stdout;
}, Effect.scoped);

const decodeJson = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema));

const readCommits = Effect.fn("generateReleaseNotes.readCommits")(function* (
  previousTag: string,
  ref: string,
) {
  // Merged branches would otherwise add every work-in-progress commit to the range.
  const log = yield* run("git", [
    "log",
    "--first-parent",
    "--reverse",
    "--format=%s%x1f%an%x1f%b%x1e",
    `${previousTag}..${ref}`,
  ]);
  return parseReleaseCommits(log);
});

const readPullRequests = Effect.fn("generateReleaseNotes.readPullRequests")(function* (
  repository: string,
  numbers: ReadonlyArray<number>,
) {
  const [owner, name] = repository.split("/");
  const pullRequests = new Map<number, PullRequest>();
  for (let start = 0; start < numbers.length; start += 100) {
    const fields = numbers
      .slice(start, start + 100)
      .map(
        (number) =>
          `pr${number}: pullRequest(number: ${number}) { body additions deletions changedFiles author { __typename login ... on User { name } } }`,
      )
      .join("\n");
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
    const response = yield* decodeJson(PullRequestQueryResponse)(
      yield* run("gh", [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${name}`,
      ]).pipe(
        // gh exits 1 when a number in the batch is not a PR here, such as an issue, yet still prints the rest.
        Effect.catchTags({ CommandFailedError: (error) => Effect.succeed(error.stdout) }),
      ),
    );
    for (const [alias, pullRequest] of Object.entries(response.data.repository)) {
      if (pullRequest) pullRequests.set(Number(alias.slice(2)), pullRequest);
    }
  }
  return pullRequests;
});

const readFullChangelog = Effect.fn("generateReleaseNotes.readFullChangelog")(function* (options: {
  readonly repository: string;
  readonly tag: string;
  readonly ref: string;
  readonly previousTag: string;
}) {
  const response = yield* run("gh", [
    "api",
    `repos/${options.repository}/releases/generate-notes`,
    "-f",
    `tag_name=${options.tag}`,
    "-f",
    `target_commitish=${options.ref}`,
    "-f",
    `previous_tag_name=${options.previousTag}`,
  ]);
  return (yield* decodeJson(GeneratedNotes)(response)).body;
});

export function summaryText(response: typeof SummaryResponse.Type): Option.Option<string> {
  // A response cut off by max_tokens or a refusal can carry partial text; publishing it would cut the notes short.
  if (response.stop_reason !== "end_turn") return Option.none();
  const text = response.content
    .flatMap((block) => (block.type === "text" && block.text ? [block.text] : []))
    .join("")
    .trim();
  return text === "" ? Option.none() : Option.some(text);
}

const summarize = Effect.fn("generateReleaseNotes.summarize")(function* (input: string) {
  const baseUrl = yield* Config.Redacted("ANTHROPIC_BASE_URL");
  const authToken = yield* Config.Redacted("ANTHROPIC_AUTH_TOKEN");
  const httpClient = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatusOk,
    HttpClient.retryTransient({ schedule: Schedule.exponential("2 seconds"), times: 4 }),
  );
  const response = yield* HttpClientRequest.post(
    `${Redacted.value(baseUrl).replace(/\/+$/, "")}/v1/messages`,
  ).pipe(
    HttpClientRequest.bearerToken(authToken),
    HttpClientRequest.setHeaders({
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    }),
    HttpClientRequest.bodyJsonUnsafe({
      model: SUMMARY_MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      fallbacks: "default",
      system: [
        { type: "text", text: BALANCER_IDENTITY },
        { type: "text", text: SUMMARY_INSTRUCTIONS },
      ],
      messages: [{ role: "user", content: `Commits:\n${input}` }],
    }),
    httpClient.execute,
    Effect.flatMap(HttpClientResponse.schemaBodyJson(SummaryResponse)),
    Effect.timeout("5 minutes"),
  );
  yield* Effect.logInfo("release summary generated").pipe(
    Effect.annotateLogs({
      model: SUMMARY_MODEL,
      stopReason: response.stop_reason,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    }),
  );
  return summaryText(response);
});

const command = Command.make(
  "generate-release-notes",
  {
    repository: Flag.String("repository").pipe(Flag.withDescription("GitHub owner/name.")),
    tag: Flag.String("tag").pipe(Flag.withDescription("Tag being released.")),
    ref: Flag.String("ref").pipe(Flag.withDescription("Commit being released.")),
    previousTag: Flag.String("previous-tag").pipe(Flag.withDescription("Previous release tag.")),
    version: Flag.String("version").pipe(Flag.withDescription("Version shown in the header.")),
    output: Flag.String("output").pipe(Flag.withDescription("File to write the notes to.")),
  },
  ({ repository, tag, ref, previousTag, version, output }) =>
    Effect.gen(function* () {
      // The header counts every commit in the range; the summary skips mobile-only work.
      const allCommits = yield* readCommits(previousTag, ref);
      if (allCommits.length === 0) {
        return yield* new EmptyReleaseRangeError({ range: `${previousTag}..${ref}` });
      }
      const commits = allCommits.filter(isReleaseNoteCommit);
      const numbers = [
        ...new Set(allCommits.flatMap(({ subject }) => pullRequestNumber(subject) ?? [])),
      ];
      const [pullRequests, fullChangelog] = yield* Effect.all(
        [
          readPullRequests(repository, numbers),
          readFullChangelog({ repository, tag, ref, previousTag }),
        ],
        { concurrency: "unbounded" },
      );
      const header = buildReleaseHeader(
        version,
        allCommits.length,
        countContributors(allCommits, pullRequests),
      );
      // With no summary, write nothing: the release falls back to GitHub's generated notes.
      const summary =
        commits.length === 0
          ? Option.none<string>()
          : yield* summarize(buildSummaryInput(commits, pullRequests));
      if (Option.isNone(summary)) {
        return yield* Effect.logWarning("no release summary, leaving GitHub's notes in place");
      }
      const fs = yield* FileSystem.FileSystem;
      // Publish uses the file when it exists, so a partial write must never land at `output`.
      yield* fs.writeFileString(
        `${output}.tmp`,
        assembleReleaseNotes(header, summary.value, fullChangelog),
      );
      yield* fs.rename(`${output}.tmp`, output);
      yield* Effect.logInfo("release notes written").pipe(
        Effect.annotateLogs({ output, commits: commits.length }),
      );
    }),
).pipe(
  Command.withDescription("Write release notes with a model summary over GitHub's full list."),
);

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Logger.layer([Logger.consolePretty()]),
        NodeServices.layer,
        FetchHttpClient.layer,
      ),
    ),
    NodeRuntime.runMain,
  );
}
