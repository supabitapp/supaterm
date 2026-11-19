export function buildThreadTitleRegenerationMenuItems(input: {
  readonly supported: boolean;
  readonly isRegenerating: boolean;
}) {
  if (!input.supported) return [];

  return [
    {
      id: "regenerate-title",
      title: input.isRegenerating ? "Regenerating…" : "Regenerate title",
      image: "arrow.clockwise",
      ...(input.isRegenerating ? { attributes: { disabled: true } } : {}),
    },
  ];
}
