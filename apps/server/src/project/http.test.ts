import { assert, it } from "@effect/vitest";
import { ProjectId } from "@supaterm/contracts";
import * as Effect from "effect/Effect";

import {
  ProjectConflictError,
  ProjectNotEmptyError,
  ProjectNotFoundError,
} from "./ProjectService.ts";
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
