import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import {
  assignProjectColors,
  preferredProjectColor,
  projectColorKey,
  projectMonogram,
  type ProjectIdentity,
} from "@supaterm/shared/projectIdentity";
import { environmentProjects } from "./projects";

const projectColorsAtom = Atom.make((get) =>
  assignProjectColors(
    get(environmentProjects.projectsAtom).filter((project) => !project.isScratch),
  ),
).pipe(Atom.withLabel("project-colors"));

const projectColorAtom = Atom.family((colorKey: string) =>
  Atom.make((get) => get(projectColorsAtom).get(colorKey) ?? preferredProjectColor(colorKey)).pipe(
    Atom.withLabel(`project-color:${colorKey}`),
  ),
);

export function useProjectIdentity(projectName: string): ProjectIdentity {
  return {
    monogram: projectMonogram(projectName),
    color: useAtomValue(projectColorAtom(projectColorKey(projectName))),
  };
}
