import { useAtomValue } from "@effect/atom-react";
import {
  environmentConnectionAddress,
  type EnvironmentPresentation,
} from "@supaterm/client-runtime/connection";
import {
  createEnvironmentPresentationAtoms,
  createEnvironmentSummaryAtoms,
} from "@supaterm/client-runtime/state/presentation";
import type { EnvironmentId } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";
import * as Option from "effect/Option";

import { environmentCatalog } from "../connection/catalog";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";
import { environmentSession } from "./session";
import { createThreadListEnvironmentsAtom } from "./thread-list-environments";

export const environmentPresentations = createEnvironmentPresentationAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  stateAtom: environmentCatalog.stateAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});

export const { connectedEnvironmentIdsAtom, offlineEnvironmentIdsAtom } =
  createEnvironmentSummaryAtoms({
    catalogValueAtom: environmentCatalog.catalogValueAtom,
    presentationAtom: environmentPresentations.presentationAtom,
  });

export const threadListEnvironmentsAtom = createThreadListEnvironmentsAtom(
  environmentServerConfigsAtom,
  connectedEnvironmentIdsAtom,
);

export const environmentConnectionAddressAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const presentation = get(environmentPresentations.presentationAtom(environmentId));
    if (presentation === null) return null;
    const prepared = Option.getOrNull(
      get(environmentSession.preparedConnectionValueAtom(environmentId)),
    );
    return environmentConnectionAddress({
      entry: presentation.entry,
      connectionState: presentation.connection.phase,
      connectedTarget: prepared?.target,
    });
  }).pipe(Atom.withLabel(`mobile:environment-connection-address:${environmentId}`)),
);

const EMPTY_ENVIRONMENT_PRESENTATION_ATOM = Atom.make<EnvironmentPresentation | null>(null).pipe(
  Atom.withLabel("mobile-environment-presentation:empty"),
);

export function useEnvironmentPresentation(environmentId: EnvironmentId | null) {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const presentation = useAtomValue(
    environmentId === null
      ? EMPTY_ENVIRONMENT_PRESENTATION_ATOM
      : environmentPresentations.presentationAtom(environmentId),
  );
  return {
    isReady: catalog.isReady,
    presentation,
  };
}
