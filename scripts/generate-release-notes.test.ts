import { assert, it } from "@effect/vitest";

import * as Option from "effect/Option";

import {
  countContributors,
  isReleaseNoteCommit,
  parseReleaseCommits,
  summaryText,
  type PullRequest,
} from "./generate-release-notes.ts";

const pullRequest = (author: PullRequest["author"]): PullRequest => ({
  body: "",
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  author,
});

it("reads merge commits as their PR title and number, like squashed ones", () => {
  const record = (subject: string, author: string, body = "") =>
    `${subject}\x1f${author}\x1f${body}\x1e\n`;
  const log = [
    record(
      "Merge pull request #603 from supabitapp/khoi/remove-mobile-e2e",
      "Khoi",
      "chore(mobile): remove the end-to-end suite\n\nLonger description.\n",
    ),
    record("fix(web): pinned messages scroll into view (#592)", "Khoi"),
    record("new skill", "Khoi"),
    record("Merge pull request #7 from fork/branch", "Khoi"),
  ].join("");

  assert.deepStrictEqual(parseReleaseCommits(log), [
    { subject: "chore(mobile): remove the end-to-end suite (#603)" },
    { subject: "fix(web): pinned messages scroll into view (#592)", authorName: "Khoi" },
    { subject: "new skill", authorName: "Khoi" },
    { subject: "Merge pull request #7 from fork/branch", authorName: "Khoi" },
  ]);
});

it("counts each person once and leaves out bots", () => {
  const commits = [
    { subject: "fix(web): one (#1)", authorName: "Ada Lovelace" },
    { subject: "fix(web): two (#2)", authorName: "Ada Lovelace" },
    { subject: "chore: bump (#3)", authorName: "dependabot[bot]" },
    { subject: "fix: direct push by a PR author", authorName: "Ada Lovelace" },
    { subject: "fix: direct push by someone else", authorName: "Grace Hopper" },
    { subject: "chore: direct push by a bot", authorName: "supaterm[bot]" },
    { subject: "fix(web): four (#4)", authorName: "Linus T" },
    { subject: "fix: direct push by a PR author with no profile name", authorName: "Linus T" },
    { subject: "fix(web): five, whose PR did not resolve (#5)", authorName: "Ken T" },
  ];
  const pullRequests = new Map([
    [1, pullRequest({ __typename: "User", login: "ada", name: "Ada Lovelace" })],
    [2, pullRequest({ __typename: "User", login: "ada", name: "Ada Lovelace" })],
    [3, pullRequest({ __typename: "Bot", login: "dependabot" })],
    [4, pullRequest({ __typename: "User", login: "linus", name: null })],
  ]);

  assert.equal(countContributors(commits, pullRequests), 4);
});

it("does not take whoever merged a PR for its author", () => {
  const commits = parseReleaseCommits(
    "Merge pull request #8 from ada/fix\x1fGrace Hopper\x1ffix(web): contributed fix\x1e\n" +
      "fix: direct push by the maintainer who merged #8\x1fGrace Hopper\x1f\x1e",
  );
  const pullRequests = new Map([
    [8, pullRequest({ __typename: "User", login: "ada", name: "Ada Lovelace" })],
  ]);

  assert.equal(countContributors(commits, pullRequests), 2);
});

it("leaves mobile-only scopes out and keeps shared ones", () => {
  const subjects = {
    "fix(mobile): a": false,
    "feat(android): b": false,
    "fix(ios)!: c": false,
    "fix(web,mobile): d": true,
    "feat(mobile,web): f": true,
    "fix(server): e": true,
  };
  for (const [subject, kept] of Object.entries(subjects)) {
    assert.equal(isReleaseNoteCommit({ subject }), kept, subject);
  }
});

it("uses model text only from a response that ended its turn", () => {
  const content = [
    { type: "thinking" },
    { type: "text", text: " ## Highlights\n" },
    { type: "text", text: "X " },
  ];
  assert.deepStrictEqual(
    summaryText({ stop_reason: "end_turn", content }),
    Option.some("## Highlights\nX"),
  );
  assert.deepStrictEqual(summaryText({ stop_reason: "max_tokens", content }), Option.none());
  assert.deepStrictEqual(summaryText({ stop_reason: "refusal", content }), Option.none());
});
