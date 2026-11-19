import { getMaterialColors, isDynamicColorAvailable } from "@expo/ui/jetpack-compose";

export const isSystemColorsAvailable = isDynamicColorAvailable;

export function readSystemColorPalettes() {
  if (!isDynamicColorAvailable) return null;

  return {
    light: getMaterialColors({ scheme: "light" }),
    dark: getMaterialColors({ scheme: "dark" }),
  };
}
