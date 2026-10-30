import type { ElementType } from "react";
import type { SourceControlProviderInfo } from "@supaterm/contracts";
import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";
import type {
  ChangeRequestTerminology,
  SourceControlDefinition,
} from "@supaterm/client-runtime/source-control-clients";
import {
  AzureDevOpsIcon,
  BitbucketIcon,
  ForgejoIcon,
  GitCafeIcon,
  GitHubIcon,
  GitLabIcon,
} from "./components/Icons";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";

export type { ChangeRequestTerminology } from "@supaterm/client-runtime/source-control-clients";

type SourceControlIcon = ElementType<{ className?: string }>;

const SOURCE_CONTROL_ICONS: Partial<Record<string, SourceControlIcon>> = {
  github: GitHubIcon,
  gitlab: GitLabIcon,
  forgejo: ForgejoIcon,
  bitbucket: BitbucketIcon,
  "azure-devops": AzureDevOpsIcon,
  gitcafe: GitCafeIcon,
};

export function sourceControlIcon(definition: SourceControlDefinition): SourceControlIcon {
  return SOURCE_CONTROL_ICONS[definition.kind] ?? PullRequestGlyph.pullRequest;
}

export interface SourceControlPresentation {
  readonly definition: SourceControlDefinition;
  readonly providerName: string;
  readonly terminology: ChangeRequestTerminology;
  readonly Icon: SourceControlIcon;
}

function presentDefinition(
  definition: SourceControlDefinition,
  providerName: string,
): SourceControlPresentation {
  return {
    definition,
    providerName,
    terminology: definition.changeRequest,
    Icon: sourceControlIcon(definition),
  };
}

export function getSourceControlPresentation(
  provider: SourceControlProviderInfo | null | undefined,
): SourceControlPresentation {
  const definition = sourceControlClients.get(provider?.kind);
  return presentDefinition(definition, provider?.name || definition.label);
}

export function getSourceControlPresentationForKind(kind: string): SourceControlPresentation {
  const definition = sourceControlClients.get(kind);
  return presentDefinition(definition, definition.label);
}
