export function hasTextSelection(): boolean {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return (
      element.selectionStart !== null &&
      element.selectionEnd !== null &&
      element.selectionStart !== element.selectionEnd
    );
  }

  const selection = document.getSelection();
  return selection !== null && !selection.isCollapsed;
}
