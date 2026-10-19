import type { useThreadHeaderOptions as useIosThreadHeaderOptions } from "./useThreadHeaderOptions";

// oxlint-disable-next-line supaterm/no-hookless-use-function -- Android stub of a hook; the iOS file calls hooks.
export function useThreadHeaderOptions(
  props: Parameters<typeof useIosThreadHeaderOptions>[0],
): ReturnType<typeof useIosThreadHeaderOptions> {
  return {
    options: { contentStyle: { backgroundColor: props.headerColor } },

    optionsVersion: [],
    sidebar: true,
    fallback: null,
  };
}
