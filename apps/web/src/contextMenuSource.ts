export function contextMenuSourceOf(event: Pick<MouseEvent, "type" | "button" | "detail">) {
  return (event.type === "click" ? event.detail === 0 : event.button === -1) ? "keyboard" : "mouse";
}
