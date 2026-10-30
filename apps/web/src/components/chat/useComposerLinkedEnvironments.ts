import { useAtomValue } from "@effect/atom-react";
import { linkedEnvironmentNames } from "@supaterm/client-runtime/link-request";
import { AuthAccessReadScope, type EnvironmentId } from "@supaterm/contracts";
import { useEnvironments } from "../../state/environments";
import { offersLinkedEnvironmentsAtom, peerLinkEnvironment } from "../../state/peerLinks";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";

export function useComposerLinkedEnvironments(environmentId: EnvironmentId) {
  const { environments } = useEnvironments();
  const offered = useAtomValue(offersLinkedEnvironmentsAtom(environmentId));
  const allowed = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const links = useEnvironmentQuery(
    offered && allowed ? peerLinkEnvironment.list({ environmentId, input: {} }) : null,
  );
  return linkedEnvironmentNames({ links: links.data?.links ?? [], environments });
}
