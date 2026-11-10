export type PullRequestEditState =
  | { readonly kind: "viewing" }
  | { readonly kind: "editing"; readonly target: string }
  | { readonly kind: "saving"; readonly target: string };

export interface PullRequestEditEvent {
  readonly kind: "open" | "cancel" | "save" | "saved" | "failed";
  readonly target: string;
}

export type PullRequestEditorView = "viewing" | "blocked" | "editing" | "saving";

export function pullRequestEditorView(
  state: PullRequestEditState,
  target: string,
): PullRequestEditorView {
  if (state.kind === "viewing") return "viewing";
  if (state.target === target) return state.kind;
  return state.kind === "saving" ? "blocked" : "viewing";
}

export function stepPullRequestEdit(
  state: PullRequestEditState,
  event: PullRequestEditEvent,
): PullRequestEditState {
  const view = pullRequestEditorView(state, event.target);
  switch (event.kind) {
    case "open":
      return view === "viewing" ? { kind: "editing", target: event.target } : state;
    case "cancel":
      return view === "editing" ? { kind: "viewing" } : state;
    case "save":
      return view === "editing" ? { kind: "saving", target: event.target } : state;
    case "saved":
      return view === "saving" ? { kind: "viewing" } : state;
    case "failed":
      return view === "saving" ? { kind: "editing", target: event.target } : state;
  }
}
