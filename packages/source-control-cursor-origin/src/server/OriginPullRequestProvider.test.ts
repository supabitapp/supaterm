import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import * as OriginCli from "./OriginCli.ts";
import * as OriginPullRequestProvider from "./OriginPullRequestProvider.ts";

it.effect("refuses a merge or review once the head moved past the one it read", () =>
  Effect.gen(function* () {
    let head = "a".repeat(40);
    const writes: Array<string> = [];
    const cli = OriginCli.OriginCli.of({
      execute: () => Effect.die("unused"),
      viewer: () => Effect.die("unused"),
      personalNamespace: () => Effect.die("unused"),
      resolveRepository: () => Effect.die("unused"),
      api: (input, schema) =>
        Effect.suspend(() => {
          if (input.method !== undefined) writes.push(`${input.method} ${input.operation}`);
          const body =
            input.operation === "getPullRequest"
              ? {
                  number: 7,
                  state: "open",
                  title: "Change",
                  head: { ref: "feature", sha: head },
                  base: { ref: "main", sha: "b".repeat(40) },
                  webUrl: "https://origin.test/acme/app/pulls/7",
                }
              : input.operation === "listChecks"
                ? { checkRuns: [] }
                : {};
          return Schema.decodeEffect(schema)(body).pipe(Effect.orDie);
        }),
    });
    const provider = yield* OriginPullRequestProvider.make.pipe(
      Effect.provideService(OriginCli.OriginCli, cli),
    );
    const ref = { cwd: "/repo", repository: "acme/app", host: "origin.test", number: 7 };
    const seen = head;
    const readChecks = provider.getChangeRequestChecks;
    assert.isDefined(readChecks);
    yield* readChecks(ref);
    head = "c".repeat(40);

    const merge = yield* provider
      .runAction({ ...ref, action: "merge", expectedHeadSha: seen })
      .pipe(Effect.flip);
    const review = yield* provider
      .submitReview({ ...ref, verdict: "approve", body: "", comments: [], expectedHeadSha: seen })
      .pipe(Effect.flip);
    assert.include(merge.message, head);
    assert.include(review.message, head);
    assert.deepEqual(writes, []);

    yield* provider.runAction({ ...ref, action: "merge", expectedHeadSha: head });
    assert.deepEqual(writes, ["POST runAction"]);
  }).pipe(Effect.scoped),
);

it.effect("refuses a merge whose head moved while its stack parent was read", () =>
  Effect.gen(function* () {
    const reviewed = "a".repeat(40);
    let head = reviewed;
    const mergedHeads: Array<string> = [];
    const cli = OriginCli.OriginCli.of({
      execute: () => Effect.die("unused"),
      viewer: () => Effect.die("unused"),
      personalNamespace: () => Effect.die("unused"),
      resolveRepository: () => Effect.die("unused"),
      api: (input, schema) =>
        Effect.suspend(() => {
          if (input.method === "POST") {
            mergedHeads.push(head);
            return Schema.decodeEffect(schema)({}).pipe(Effect.orDie);
          }
          const parent = input.path.endsWith("/6");
          const body = {
            number: parent ? 6 : 7,
            state: parent ? "merged" : "open",
            title: "Change",
            head: { ref: parent ? "base-feature" : "feature", sha: head },
            base: { ref: "main", sha: "b".repeat(40) },
            webUrl: `https://origin.test/acme/app/pulls/${parent ? 6 : 7}`,
            ...(parent ? {} : { stack: { parentPullRequest: { number: 6 } } }),
          };
          if (parent) head = "c".repeat(40);
          return Schema.decodeEffect(schema)(body).pipe(Effect.orDie);
        }),
    });
    const provider = yield* OriginPullRequestProvider.make.pipe(
      Effect.provideService(OriginCli.OriginCli, cli),
    );
    const ref = { cwd: "/repo", repository: "acme/app", host: "origin.test", number: 7 };

    const refused = yield* Effect.exit(
      provider.runAction({ ...ref, action: "merge", expectedHeadSha: reviewed }),
    );
    assert.deepEqual(mergedHeads, []);
    assert.isTrue(Exit.isFailure(refused));

    yield* provider.runAction({ ...ref, action: "merge", expectedHeadSha: head });
    assert.deepEqual(mergedHeads, [head]);
  }).pipe(Effect.scoped),
);
