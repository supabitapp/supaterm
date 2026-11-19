import type { SidebarProjectGroupingMode } from "@supaterm/contracts";
import * as Equivalence from "effect/Equivalence";
import { Atom } from "effect/reactivity";

import { environmentProjects } from "../../state/projects";
import { environmentThreadShells } from "../../state/threads";
import { buildHomeProjectScopes, sortHomeProjectScopes } from "./homeThreadList";

const sameProjectOrder = Equivalence.Array(
  Equivalence.Struct({
    memberProjectRefs: Equivalence.Array(
      Equivalence.Struct({ environmentId: Equivalence.String, projectId: Equivalence.String }),
    ),
    pinned: Equivalence.Boolean,
    archived: Equivalence.Boolean,
  }),
);

/** The home project list's order, which the new-task picker also shows: latest activity first. */
export const homeProjectOrderAtom = Atom.family((projectGroupingMode: SidebarProjectGroupingMode) =>
  Atom.make((get) =>
    sortHomeProjectScopes({
      scopes: buildHomeProjectScopes({
        projects: get(environmentProjects.projectsAtom),
        environmentId: null,
        projectGroupingMode,
      }),
      threads: get(environmentThreadShells.threadShellsAtom),
      pendingTasks: [],
      projectSortOrder: "updated_at",
    }).map((scope) => ({
      memberProjectRefs: scope.projectRefs,
      pinned: scope.pinned,
      archived: scope.archived,
    })),
  ).pipe(Atom.withEquality(sameProjectOrder)),
);
