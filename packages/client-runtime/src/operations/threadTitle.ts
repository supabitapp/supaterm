import type { ChatAttachment } from "@supaterm/contracts";
import { assistantCitationsToPlainText } from "@supaterm/shared/assistantCitations";
import { replaceComposerContextReferences } from "@supaterm/shared/composerContextReferences";
import { composerFileLinksToPlainText } from "@supaterm/shared/composerMentionTokens";
import { truncate } from "@supaterm/shared/String";
import { msg, mFallback } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

export interface ThreadTitleSeedInput {
  readonly text: string;
  readonly attachments: ReadonlyArray<Pick<ChatAttachment, "type" | "name">>;
  readonly fallbackLabels?: ReadonlyArray<string | null | undefined>;
}

function normalizeTitleSeed(value: string): string {
  // Mentioned macOS paths can be NFD; titles show them composed.
  return assistantCitationsToPlainText(value).trim().replace(/\s+/gu, " ").normalize("NFC");
}

function attachedImagesTitle(count: number, resolve: MFunctionType): string {
  return count === 1 ? resolve(msg("Attached image")) : resolve(msg("Attached images"));
}

export function threadTitleTextFromPrompt(
  value: string,
  resolve: MFunctionType = mFallback,
): string {
  const imageIds = new Set<string>();
  const prose = replaceComposerContextReferences(value, (reference) => {
    if (reference.kind === "image") {
      imageIds.add(reference.contextId);
      return "";
    }
    return reference.label;
  });
  return (
    normalizeTitleSeed(composerFileLinksToPlainText(prose)) ||
    (imageIds.size > 0 ? attachedImagesTitle(imageIds.size, resolve) : "")
  );
}

export function deriveThreadTitleSeed(
  input: ThreadTitleSeedInput,
  resolve: MFunctionType = mFallback,
): string {
  const text = threadTitleTextFromPrompt(input.text, resolve);
  if (text.length > 0) {
    return truncate(text);
  }

  const images = input.attachments.filter((attachment) => attachment.type === "image");
  if (images.length > 0) {
    return attachedImagesTitle(images.length, resolve);
  }

  const attachmentName = normalizeTitleSeed(input.attachments[0]?.name ?? "");
  if (attachmentName.length > 0) {
    return truncate(resolve(msg("File: {name}", { name: attachmentName })));
  }

  for (const label of input.fallbackLabels ?? []) {
    const normalized = normalizeTitleSeed(label ?? "");
    if (normalized.length > 0) {
      return truncate(normalized);
    }
  }

  return resolve(msg("New thread"));
}
