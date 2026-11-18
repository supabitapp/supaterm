import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { QueuedThreadRun } from "@supaterm/client-runtime/state/thread-workflows";
import { resolveUserMessagePresentation } from "@supaterm/client-runtime/user-message";
import type { ChatAttachment, EnvironmentId } from "@supaterm/contracts";
import { Image } from "expo-image";
import { useRef } from "react";
import { type AccessibilityActionEvent, Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import type { FilePreviewSource } from "../../components/ui/FilePreviewModal";
import { Menu } from "../../components/ui/Menu";
import { assetImageSource } from "../../lib/assetImageSource";
import { useAssetUrl } from "../../state/assets";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import type { ThreadQueueRowControls } from "./threadQueueControlPresentation";

const THUMBNAIL_LIMIT = 3;
const TOUCH_SLOP = 10;

export type QueueMessageAction = "steer" | "edit" | "remove";

export function ThreadQueueMessage(props: {
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly message: QueuedThreadRun["message"];
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly controls: ThreadQueueRowControls;
  readonly canPromoteToSteer: boolean;
  readonly canSendNow: boolean;
  readonly onAction: (action: QueueMessageAction) => void;
  readonly onPressPreview: (source: FilePreviewSource) => void;
}) {
  const touchRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const actions = [
    ...(props.canPromoteToSteer || props.canSendNow
      ? [
          {
            id: "steer",
            title: "Send now",
            attributes: { disabled: !props.controls.canSend },
            image: "arrow.up",
          },
        ]
      : []),
    {
      id: "edit",
      title: "Edit",
      attributes: { disabled: !props.controls.canEdit },
      image: "pencil",
    },
    {
      id: "remove",
      title: "Remove",
      attributes: { disabled: !props.controls.canDismiss, destructive: true },
    },
  ];
  const accessibilityProps = {
    accessibilityRole: "button" as const,
    accessibilityLabel: props.title,
    accessibilityHint: "Opens this message in the composer. Touch and hold for more actions.",
    accessibilityState: { disabled: !props.controls.canOpen },
    accessibilityActions: actions.flatMap((action) =>
      action.attributes.disabled ? [] : [{ name: action.id, label: action.title }],
    ),
    onAccessibilityAction: ({ nativeEvent }: AccessibilityActionEvent) =>
      props.onAction(
        nativeEvent.actionName === "activate"
          ? "edit"
          : (nativeEvent.actionName as QueueMessageAction),
      ),
    onAccessibilityTap: () => props.onAction("edit"),
  };

  return (
    <Menu
      {...accessibilityProps}
      shouldOpenOnLongPress
      actions={actions}
      onPressAction={({ nativeEvent }) => props.onAction(nativeEvent.event as QueueMessageAction)}
    >
      <Pressable
        {...accessibilityProps}
        disabled={!props.controls.canOpen}
        onTouchStart={({ nativeEvent }) => {
          touchRef.current = { x: nativeEvent.pageX, y: nativeEvent.pageY, moved: false };
        }}
        onTouchMove={({ nativeEvent }) => {
          const touch = touchRef.current;
          if (
            touch &&
            (Math.abs(nativeEvent.pageX - touch.x) > TOUCH_SLOP ||
              Math.abs(nativeEvent.pageY - touch.y) > TOUCH_SLOP)
          ) {
            touch.moved = true;
          }
        }}
        onPress={({ nativeEvent }) => {
          if (typeof nativeEvent.identifier === "number" && touchRef.current?.moved) return;
          props.onAction("edit");
        }}
        className="min-h-16 gap-2 px-3 py-4 active:opacity-70"
      >
        {props.controls.isEditing ? (
          <Text className="text-xs text-foreground-muted">Editing in composer</Text>
        ) : null}
        {props.message ? (
          <QueuedRunSender environmentId={props.environmentId} message={props.message} />
        ) : null}
        <Text className="text-base text-foreground" numberOfLines={3}>
          {props.title}
        </Text>
        <QueueAttachmentThumbnails
          environmentId={props.environmentId}
          attachments={props.attachments}
          onPressPreview={props.onPressPreview}
        />
      </Pressable>
    </Menu>
  );
}

/** Who sent a queued message, as its sent form shows it in the thread. */
function QueuedRunSender(props: {
  readonly environmentId: EnvironmentId;
  readonly message: NonNullable<QueuedThreadRun["message"]>;
}) {
  const { attribution, scheduledTaskId } = resolveUserMessagePresentation(props.message);
  const senderThreadId = attribution === "agent" ? props.message.senderThreadId : undefined;
  const senderShell = useQuietThreadShell(
    senderThreadId ? scopeThreadRef(props.environmentId, senderThreadId) : null,
  );
  const tasks = useEnvironmentQuery(
    scheduledTaskId
      ? serverEnvironment.scheduledTasksLive({ environmentId: props.environmentId, input: {} })
      : null,
  );
  const sender =
    attribution === "automation"
      ? {
          icon: "calendar.badge.clock" as const,
          label:
            tasks.data?.tasks.find((task) => task.id === scheduledTaskId)?.title ?? "Automation",
        }
      : attribution === "agent"
        ? {
            icon: "bubble.left.and.bubble.right" as const,
            label: senderShell?.title.trim() || "Agent",
          }
        : attribution === "supaterm"
          ? { icon: null, label: "Sent by Supaterm" }
          : null;
  if (sender === null) return null;
  return (
    <View className="flex-row items-center gap-1">
      {sender.icon ? (
        <SymbolView
          name={sender.icon}
          size={11}
          weight="medium"
          tintColorClassName="accent-foreground-muted"
          type="monochrome"
        />
      ) : null}
      <Text
        numberOfLines={1}
        className="min-w-0 shrink font-supaterm-medium text-2xs text-foreground-muted"
      >
        {sender.label}
      </Text>
    </View>
  );
}

function QueueAttachmentThumbnails(props: {
  readonly environmentId: EnvironmentId;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly onPressPreview: (source: FilePreviewSource) => void;
}) {
  const images = props.attachments.filter((attachment) => attachment.mimeType.startsWith("image/"));
  const gallery = images.map((attachment) => queueImagePreview(props.environmentId, attachment));
  const shown = images.slice(0, THUMBNAIL_LIMIT);
  const overflow = props.attachments.length - shown.length;
  if (props.attachments.length === 0) return null;
  return (
    <View className="shrink-0 flex-row items-center gap-1">
      {shown.map((attachment) => (
        <QueueAttachmentThumbnail
          key={attachment.id}
          environmentId={props.environmentId}
          attachment={attachment}
          onPress={() =>
            props.onPressPreview({
              ...queueImagePreview(props.environmentId, attachment),
              gallery,
            })
          }
        />
      ))}
      {overflow > 0 ? (
        <View className="h-6 min-w-6 items-center justify-center rounded bg-subtle px-1">
          <Text className="text-2xs tabular-nums text-foreground-muted">
            {shown.length === 0 ? `${overflow}` : `+${overflow}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function queueAttachmentResource(attachment: ChatAttachment) {
  return {
    _tag: "attachment",
    attachmentId: attachment.id,
    fileName: attachment.name,
    mimeType: attachment.mimeType,
    disposition: "inline",
  } as const;
}

function queueImagePreview(environmentId: EnvironmentId, attachment: ChatAttachment) {
  const resource = queueAttachmentResource(attachment);
  return {
    kind: "image",
    environmentId,
    resource,
    name: attachment.name,
    mimeType: attachment.mimeType,
    actionsSource: {
      name: attachment.name,
      mimeType: attachment.mimeType,
      environmentId,
      resource,
    },
  } as const;
}

function QueueAttachmentThumbnail(props: {
  readonly environmentId: EnvironmentId;
  readonly attachment: ChatAttachment;
  readonly onPress: () => void;
}) {
  const resource = queueAttachmentResource(props.attachment);
  const url = useAssetUrl(props.environmentId, resource);
  return (
    // Its own press target, so tapping an image previews it instead of editing the message.
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={`Open ${props.attachment.name}`}
      hitSlop={6}
      onPress={props.onPress}
      className="active:opacity-70"
    >
      {url === null ? (
        <View className="h-6 w-6 rounded bg-subtle" />
      ) : (
        <Image
          source={assetImageSource(props.environmentId, resource, url)}
          cachePolicy="memory-disk"
          contentFit="cover"
          style={{ width: 24, height: 24, borderRadius: 4 }}
          accessibilityIgnoresInvertColors
        />
      )}
    </Pressable>
  );
}
