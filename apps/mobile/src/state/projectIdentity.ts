import { assignProjectColors, preferredProjectColor } from "@supaterm/shared/projectIdentity";
import { Atom } from "effect/reactivity";

import { environmentProjects } from "./projects";

const projectColorsAtom = Atom.make((get) =>
  assignProjectColors(
    get(environmentProjects.projectsAtom).filter((project) => !project.isScratch),
  ),
).pipe(Atom.withLabel("mobile-project-colors"));

export const projectMonogramColorAtom = Atom.family((colorKey: string) =>
  Atom.make((get) => get(projectColorsAtom).get(colorKey) ?? preferredProjectColor(colorKey)).pipe(
    Atom.withLabel(`mobile-project-color:${colorKey}`),
  ),
);
