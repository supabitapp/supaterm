import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import {
  assignProjectColors,
  preferredProjectColor,
  projectColorKey,
  projectMonogram,
} from "@supaterm/shared/projectIdentity";

import { environmentProjects } from "../state/projects";

const projectColorsAtom = Atom.make((get) =>
  assignProjectColors(
    get(environmentProjects.projectsAtom).filter((project) => !project.isScratch),
  ),
);
const projectColorAtom = Atom.family((colorKey: string) =>
  Atom.make((get) => get(projectColorsAtom).get(colorKey) ?? preferredProjectColor(colorKey)),
);

export function useProjectIdentity(projectName: string) {
  return {
    monogram: projectMonogram(projectName),
    color: useAtomValue(projectColorAtom(projectColorKey(projectName))),
  };
}
