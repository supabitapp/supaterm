import { useAtomValue } from "@effect/atom-react";
import {
  toolGroupImageKey,
  type ToolGroupImage,
} from "@supaterm/client-runtime/work-log/presentation";
import type { EnvironmentId } from "@supaterm/contracts";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { FilePreviewGallery } from "../../components/FilePreviewGallery";
import type { FilePreviewItem, FilePreviewSource } from "../../components/FilePreviewModal.types";
import { AppText as Text } from "../../components/ui/AppText";
import { MotionPresence } from "../../components/ui/MotionPresence";
import { showToolImagesAtom } from "../../state/preferences";
import { ThreadMarkdownImage } from "./ThreadMarkdownImage";

const VISIBLE_IMAGE_LIMIT = 12;
const THUMBNAIL_HEIGHT = 88;
const NO_IMAGES: ReadonlyArray<ToolGroupImage> = [];

export function ThreadToolImageStrip(props: {
  readonly images: ReadonlyArray<ToolGroupImage> | undefined;
  readonly inset?: boolean;
  readonly environmentId: EnvironmentId;
  readonly onPressPreview: (source: FilePreviewSource) => void;
}) {
  const enabled = useAtomValue(showToolImagesAtom);
  const images = enabled && props.images?.length ? props.images : NO_IMAGES;
  const [retained, setRetained] = useState(images);
  if (images.length > 0 && images !== retained) setRetained(images);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? retained : retained.slice(0, VISIBLE_IMAGE_LIMIT);
  const hiddenCount = retained.length - visible.length;
  const gallery = useMemo(
    () =>
      retained.map((image): FilePreviewItem => ({
        kind: "image",
        environmentId: props.environmentId,
        resource: image.resource,
        name: image.alt,
        ...(image.srcFragment ? { srcFragment: image.srcFragment } : {}),
      })),
    [retained, props.environmentId],
  );

  return (
    <MotionPresence
      visible={images.length > 0}
      onHidden={() => setRetained(NO_IMAGES)}
      className={props.inset === false ? "mx-2 mb-2" : "ml-7 mt-1"}
    >
      {retained.length > 0 ? (
        <FilePreviewGallery value={gallery}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-1.5">
              {visible.map((image) => (
                <ThreadMarkdownImage
                  key={toolGroupImageKey(image)}
                  environmentId={props.environmentId}
                  resource={image.resource}
                  alt={image.alt}
                  showCaption={false}
                  srcFragment={image.srcFragment}
                  thumbnailHeight={THUMBNAIL_HEIGHT}
                  onPressPreview={props.onPressPreview}
                />
              ))}
              {hiddenCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${hiddenCount} more images`}
                  onPress={() => setShowAll(true)}
                  className="w-16 items-center justify-center rounded-[10px] bg-md-code-bg active:opacity-70"
                  style={{ height: THUMBNAIL_HEIGHT }}
                >
                  <Text className="text-sm text-foreground-muted">+{hiddenCount}</Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        </FilePreviewGallery>
      ) : null}
    </MotionPresence>
  );
}
