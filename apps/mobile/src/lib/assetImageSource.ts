import type { AssetResource, EnvironmentId } from "@supaterm/contracts";
import type { ImageSource } from "expo-image";

export function assetImageSource(
  environmentId: EnvironmentId,
  resource: AssetResource,
  uri: string,
): ImageSource {
  return resource._tag === "attachment"
    ? {
        uri,
        cacheKey: `supaterm-attachment:${JSON.stringify([environmentId, resource.attachmentId])}`,
      }
    : { uri };
}
