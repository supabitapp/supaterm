import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
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
