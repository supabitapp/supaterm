import { assert, it } from "@effect/vitest";
import { ProjectId } from "@supaterm/contracts";
import * as Effect from "effect/Effect";

import {
  ProjectConflictError,
  ProjectNotEmptyError,
  ProjectNotFoundError,
  ProjectOperationError,
} from "./ProjectService.ts";
import { ServerRuntimeStartupError } from "../serverRuntimeStartup.ts";
import { failProjectMutation } from "./http.ts";

const projectId = ProjectId.make("project:http-mutation");

it.effect.each([
  { cause: new ProjectNotFoundError({ projectId }), reason: "invalid_command" },
  { cause: new ProjectNotEmptyError({ projectId }), reason: "project_not_empty" },
  {
    cause: new ProjectConflictError({
      projectId,
      workspaceRoot: "/workspace/project",
      conflictingProjectId: ProjectId.make("project:http-mutation-conflict"),
    }),
    reason: "invalid_command",
  },
])("maps expected project mutation failures to invalid requests", ({ cause, reason }) =>
  Effect.gen(function* () {
    const error = yield* failProjectMutation(cause).pipe(Effect.flip);

    assert.equal(error._tag, "EnvironmentRequestInvalidError");
    assert.equal(error.code, "invalid_request");
    assert.equal(error.reason, reason);
  }),
);

it.effect.each([
  new ProjectOperationError({
    operation: "dispatch-project-command",
    projectId,
    cause: "database unavailable",
  }),
  new ServerRuntimeStartupError({
    mode: "web",
    host: null,
    port: 0,
    cause: "startup unavailable",
  }),
])("keeps operational and startup failures internal", (cause) =>
  Effect.gen(function* () {
    const error = yield* failProjectMutation(cause).pipe(Effect.flip);

    assert.equal(error._tag, "EnvironmentInternalError");
    assert.equal(error.code, "internal_error");
    assert.equal(error.reason, "project_mutation_failed");
  }),
);
