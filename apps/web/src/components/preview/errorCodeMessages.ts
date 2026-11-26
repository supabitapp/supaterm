import { PREVIEW_ERROR_CODE_MESSAGES } from "./previewConstants";
import { msg } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";

export function describePreviewError(description: string, resolve: MessageResolver = m): string {
  const friendly = PREVIEW_ERROR_CODE_MESSAGES[description];
  if (friendly) return resolve(friendly);
  if (description.length > 0) return description;
  return resolve(msg("Network error"));
}
