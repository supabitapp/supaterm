import { StackActions, useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { PullRequestCardGroup, PullRequestCardRow } from "./PullRequestControls";
import { pullRequestLayerParams } from "./pullRequestStack";
import { pullRequestStatus } from "./pullRequestStatus";
import type { PullRequestParams } from "./usePullRequestDiff";
import type { PullRequestStackState } from "./usePullRequestStack";
import { PullRequestGlyph } from "./pullRequestGlyphs";
import { withKnownPullRequestSummary } from "../../state/use-thread-pr";
import { T, useGT, useMessages, Var } from "gt-react-native";

export function PullRequestStackCard(props: {
  readonly params: PullRequestParams;
  readonly state: PullRequestStackState;
}) {
  const gt = useGT();
  const m = useMessages();
  const navigation = useNavigation();
  const [expanded, setExpanded] = useState(false);
  const stack = props.state.stack;
  if (!stack) {
    const summary =
      props.params.initialSummary?.number === props.params.number
        ? props.params.initialSummary.stack
        : undefined;
    if (!summary) return null;
    return (
      <PullRequestCardGroup>
        <PullRequestCardRow
          title={gt("Stack", { $context: "stacked pull requests" })}
          icon={PullRequestGlyph.stack}
          value={`${summary.position} of ${summary.size}`}
          last
        />
      </PullRequestCardGroup>
    );
  }
  const position = stack.layers.findIndex((layer) => layer.number === props.params.number) + 1;
  return (
    <PullRequestCardGroup>
      <PullRequestCardRow
        title={gt("Stack", { $context: "stacked pull requests" })}
        icon={PullRequestGlyph.stack}
        value={gt("{position} of {total}", { position, total: stack.layers.length })}
        accessibilityLabel={
          props.state.isFresh
            ? gt("Stack, {position} of {total}", { position, total: stack.layers.length })
            : gt("Stack, {position} of {total}, showing saved stack", {
                position,
                total: stack.layers.length,
              })
        }
        expanded={expanded}
        onPress={() => setExpanded(!expanded)}
        last={!expanded}
      />
      {expanded ? (
        <View>
          {stack.layers.map((layer, index) => {
            const selected = layer.number === props.params.number;
            const status = pullRequestStatus(
              { state: layer.state, isDraft: layer.isDraft === true },
              m,
            );
            return (
              <View key={layer.number} className={selected ? "bg-thread-selected" : undefined}>
                <PullRequestCardRow
                  title={layer.title ?? layer.headBranch}
                  icon={status.icon}
                  tint={status.tint}
                  value={
                    selected ? gt("Current", { $context: "current stack layer" }) : status.label
                  }
                  detail={`#${layer.number} · ${gt("{position} of {total}", {
                    position: index + 1,
                    total: stack.layers.length,
                  })}`}
                  onPress={
                    selected
                      ? undefined
                      : () =>
                          navigation.dispatch(
                            StackActions.push(
                              "PullRequest",
                              withKnownPullRequestSummary(
                                pullRequestLayerParams(props.params, layer.number),
                              ),
                            ),
                          )
                  }
                  last={index === stack.layers.length - 1}
                />
              </View>
            );
          })}
          <Text className="px-4 py-3 text-xs text-foreground-muted">
            <T>
              Base: <Var>{stack.base}</Var>. Open a layer to review it or merge the stack through
              that layer.
            </T>
          </Text>
        </View>
      ) : null}
    </PullRequestCardGroup>
  );
}
