import { projectCloneProgressSummary } from "@supaterm/client-runtime/contract-labels";
import { projectCloneDisplayName, type ProjectCloneSnapshot } from "@supaterm/contracts";
import type { ComponentProps } from "react";
import { Pressable, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { cn } from "../../lib/cn";
import { useInlineConfirm } from "../../lib/useInlineConfirm";
import { AppText as Text } from "../../components/ui/AppText";
import { T, useMessages, useGT, Var } from "gt-react-native";

export function ProjectCloneBanner(props: {
  readonly clone: ProjectCloneSnapshot;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly onRemove: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { clone } = props;
  const name = projectCloneDisplayName(clone);
  const confirm = useInlineConfirm<"remove">();
  if (clone.phase === "running") {
    return (
      <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3">
        <AppActivityIndicator size="small" />
        <View className="min-w-0 flex-1">
          <Text className="font-supaterm-medium text-sm" numberOfLines={1}>
            <T>
              Cloning <Var>{name}</Var>
            </T>
          </Text>
          <Text className="text-xs text-foreground-muted" numberOfLines={1}>
            {projectCloneProgressSummary(clone, m)}
          </Text>
        </View>
        <BannerAction label={gt("Cancel")} onPress={props.onCancel} />
      </View>
    );
  }
  const cancelled = clone.phase === "cancelled";
  return (
    <View
      className={cn(
        "rounded-2xl border px-3.5 py-3",
        cancelled ? "border-warning-border bg-warning" : "border-danger-border bg-danger",
      )}
    >
      <Text
        className={cn(
          "font-supaterm-medium text-sm",
          cancelled ? "text-warning-foreground" : "text-danger-foreground",
        )}
        numberOfLines={1}
      >
        {cancelled
          ? gt("Cancelled cloning {name}", { name })
          : gt("Failed to clone {name}", { name })}
      </Text>
      {clone.error ? (
        <Text className="mt-0.5 text-xs text-danger-foreground" numberOfLines={3}>
          {clone.error}
        </Text>
      ) : null}
      <View className="mt-2 flex-row justify-end gap-2">
        <BannerAction
          label={confirm.armed === "remove" ? gt("Confirm removal") : gt("Remove project")}
          {...confirm.bind("remove", props.onRemove)}
        />
        <BannerAction label={gt("Retry")} onPress={props.onRetry} />
      </View>
    </View>
  );
}

function BannerAction({
  label,
  ...props
}: Omit<ComponentProps<typeof Pressable>, "children"> & { readonly label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      className="rounded-full border border-border bg-card px-3 py-1.5"
      {...props}
    >
      <Text className="font-supaterm-medium text-xs">{label}</Text>
    </Pressable>
  );
}
