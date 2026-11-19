export interface SentImageHandoff {
  readonly uri: string;
  readonly aspectRatio: number;
}

const MAX_ENTRIES = 64;
const images = new Map<string, SentImageHandoff>();

function remember(key: string, image: SentImageHandoff) {
  if (!Number.isFinite(image.aspectRatio) || image.aspectRatio <= 0) return;
  images.delete(key);
  images.set(key, image);
  if (images.size > MAX_ENTRIES) images.delete(images.keys().next().value!);
}

export function rememberDraftImage(attachmentId: string, image: SentImageHandoff) {
  remember(`draft:${attachmentId}`, image);
}

export function rememberSentImage(messageId: string, index: number, image: SentImageHandoff) {
  remember(`message:${messageId}:${index}`, image);
}

export function sentImageHandoff(messageId: string, index: number, draftAttachmentId?: string) {
  return (
    images.get(`message:${messageId}:${index}`) ??
    (draftAttachmentId === undefined ? undefined : images.get(`draft:${draftAttachmentId}`))
  );
}
