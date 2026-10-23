import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as TestConsole from "effect/testing/TestConsole";

import { reportCliFailure } from "./reportFailure.ts";

class RemoveFailedError extends Schema.TaggedError<RemoveFailedError>()("RemoveFailedError", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return "Could not remove the project.";
  }
}

class ServeFailedError extends Schema.TaggedError<ServeFailedError>()("ServeFailedError", {
  cause: Schema.Defect(),
}) {}

class AlreadyRenderedError extends Schema.TaggedError<AlreadyRenderedError>()(
  "AlreadyRenderedError",
  {},
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return "Shown by the CLI already.";
  }
}

const report = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    const logs: Array<unknown> = [];
    const logger = Logger.make(({ message }) => {
      logs.push(message);
    });
    yield* reportCliFailure(cause).pipe(
      Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
    );
    return { errors: (yield* TestConsole.errorLines).map(String), logs };
  }).pipe(Effect.provide(Layer.fresh(TestConsole.layer)));

it.effect("prints a typed failure and its distinct causes instead of logging a stack", () =>
  Effect.gen(function* () {
    const { errors, logs } = yield* report(
      Cause.fail(
        new RemoveFailedError({
          cause: new Error("database is locked", {
            cause: new Error("database is locked"),
          }),
        }),
      ),
    );

    assert.deepEqual(logs, []);
    assert.lengthOf(errors, 1);
    assert.include(errors[0], "ERROR");
    assert.include(errors[0], "Could not remove the project.\n  Caused by: database is locked");
    assert.notInclude(errors[0], "    at ");
    assert.equal(errors[0]?.split("database is locked").length, 2);
  }),
);

it.effect("leads with the cause when the failure has no message of its own", () =>
  Effect.gen(function* () {
    const { errors } = yield* report(
      Cause.fail(new ServeFailedError({ cause: new Error("listen EADDRINUSE 127.0.0.1:7007") })),
    );

    assert.lengthOf(errors, 1);
    assert.include(errors[0], "ERROR\n  listen EADDRINUSE 127.0.0.1:7007");
    assert.notInclude(errors[0], "Caused by");
  }),
);

it.effect("leaves failures the CLI already rendered alone", () =>
  Effect.gen(function* () {
    const { errors, logs } = yield* report(Cause.fail(new AlreadyRenderedError()));

    assert.deepEqual(errors, []);
    assert.deepEqual(logs, []);
  }),
);

it.effect.each([
  { label: "defects", cause: Cause.die(new Error("boom")) },
  { label: "failures without any message", cause: Cause.fail(new ServeFailedError({ cause: 1 })) },
])("keeps the logged cause for $label", ({ cause }) =>
  Effect.gen(function* () {
    const { errors, logs } = yield* report(cause);

    assert.deepEqual(errors, []);
    assert.lengthOf(logs, 1);
  }),
);
