import { useMemo } from "react";

import { resolveMobileCodeSurface } from "../../../lib/appearancePreferences";
import { createNativeReviewDiffStyle } from "../../review/nativeReviewDiffAdapter";
import { createNativeSourceStyle } from "../../files/nativeSourceFileAdapter";
import { useAppearancePreferences } from "./AppearancePreferencesProvider";

export function useAppearanceCodeSurface() {
  const { appearance } = useAppearancePreferences();
  const codeSurface = useMemo(
    () => resolveMobileCodeSurface(appearance.codeFontSize),
    [appearance.codeFontSize],
  );
  const nativeSourceStyle = useMemo(() => createNativeSourceStyle(codeSurface), [codeSurface]);
  const nativeReviewDiffStyle = useMemo(
    () => createNativeReviewDiffStyle(codeSurface, appearance.codeWordBreak),
    [appearance.codeWordBreak, codeSurface],
  );

  return {
    codeSurface,
    codeWordBreak: appearance.codeWordBreak,
    nativeSourceStyle,
    nativeReviewDiffStyle,
  };
}
