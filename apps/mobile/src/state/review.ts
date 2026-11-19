import { createReviewEnvironmentAtoms } from "@supaterm/client-runtime/state/review";
import type { EnvironmentId, ReviewDiffPreviewSource } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

const EMPTY_GIT_SECTIONS = Object.freeze<ReadonlyArray<ReviewDiffPreviewSource>>([]);

const lastGitSectionsFamily = Atom.family((key: string) =>
  Atom.make(EMPTY_GIT_SECTIONS).pipe(
    Atom.keepAlive,
    Atom.withLabel(`mobile:review:git-sections:${key}`),
  ),
);

export function lastReviewGitSectionsAtom(environmentId: EnvironmentId, cwd: string) {
  return lastGitSectionsFamily(JSON.stringify([environmentId, cwd]));
}

export const reviewEnvironment = createReviewEnvironmentAtoms(connectionAtomRuntime, {
  onDiffPreviewAnswer: (target, value, registry) =>
    Effect.sync(() =>
      registry.set(
        lastReviewGitSectionsAtom(target.environmentId, target.input.cwd),
        value.sources,
      ),
    ),
});
