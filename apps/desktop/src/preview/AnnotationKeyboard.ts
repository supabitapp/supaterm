interface AnnotationKeyboardEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
}

export function resolveAnnotationSubmission(event: AnnotationKeyboardEvent, canSend: boolean) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return null;
  return event.metaKey || event.ctrlKey ? (canSend ? "send" : null) : "attach";
}
