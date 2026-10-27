import * as IconNodes from "@supaterm/icons/nodes";
import type { SFSymbol } from "expo-symbols";
import { SymbolView as ExpoSymbolView } from "expo-symbols";
import { withUniwind } from "uniwind";
import { NodeIcon } from "./NodeIcon";
import type { AppSymbolViewProps } from "./AppSymbol";

export type { SFSymbol } from "expo-symbols";
export type { AppSymbolName } from "./AppSymbol";

const CUSTOM_ICONS = {
  "file.diff": IconNodes.Diff,
  "arrow.triangle.pull": IconNodes.GitPullRequest,
  "arrow.triangle.merge": IconNodes.GitMerge,
  "arrow.triangle.branch": IconNodes.GitBranch,
  "arrow.branch": IconNodes.GitBranch,
  "git.pull-request.closed": IconNodes.GitPullRequestClosed,
  "git.pull-request.draft": IconNodes.GitPullRequestDraft,
  "git.commit": IconNodes.GitCommit,
};

function AppSymbolView(props: AppSymbolViewProps) {
  const name = typeof props.name === "string" ? props.name : props.name.ios;
  const customNode = CUSTOM_ICONS[name as keyof typeof CUSTOM_ICONS];
  if (customNode) {
    return (
      <NodeIcon
        node={customNode}
        accessibilityLabel={props.accessibilityLabel}
        color={props.tintColor}
        size={props.size}
        style={props.style}
        testID={props.testID}
      />
    );
  }

  return <ExpoSymbolView {...props} name={name as SFSymbol} />;
}

export const SymbolView = withUniwind(AppSymbolView);
