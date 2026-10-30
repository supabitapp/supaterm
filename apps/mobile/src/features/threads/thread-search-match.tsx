import { splitThreadSearchText } from "@supaterm/shared/threadSearch";
import type { EnvironmentThreadSearchMatch } from "@supaterm/client-runtime/state/thread-search";

import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

export function ThreadSearchMatchExcerpt(props: {
  readonly match: EnvironmentThreadSearchMatch;
  readonly query: string;
  readonly selected?: boolean;
  readonly compact?: boolean;
  readonly sidebar?: boolean;
}) {
  const isUser = props.match.source === "user";
  const parts = splitThreadSearchText(props.match.snippet, props.query);
  return (
    <Text
      className={cn(
        props.compact ? "text-sm" : "text-xs",
        props.selected
          ? "text-thread-selected-foreground-muted"
          : props.sidebar
            ? "text-drawer-foreground-muted"
            : "text-foreground-muted",
      )}
      numberOfLines={1}
    >
      <Text
        className={cn(
          props.compact ? "text-sm font-supaterm-medium" : "text-xs font-supaterm-medium",
          props.selected
            ? "text-thread-selected-foreground"
            : isUser
              ? props.sidebar
                ? "text-drawer-foreground-muted"
                : "text-foreground-secondary"
              : "text-adaptive-emerald-600-400",
        )}
      >
        {isUser ? "You:" : "Agent:"}{" "}
      </Text>
      {parts.map((part) => (
        <Text
          className={cn(
            props.compact ? "text-sm" : "text-xs",
            part.highlighted && "font-supaterm-bold",
            props.selected
              ? "text-thread-selected-foreground"
              : part.highlighted
                ? props.sidebar
                  ? "text-drawer-foreground"
                  : "text-foreground"
                : props.sidebar
                  ? "text-drawer-foreground-muted"
                  : "text-foreground-muted",
          )}
          key={part.start}
        >
          {part.text}
        </Text>
      ))}
    </Text>
  );
}
