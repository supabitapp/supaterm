import { createContext, useContext, useEffect, useState } from "react";

import { useMediaQuery } from "./hooks/useMediaQuery";

const PANEL_ANIMATION_DURATION_MS = 200;

const PanelAnimationSuppressionContext = createContext(false);

export const PanelAnimationSuppressionProvider = PanelAnimationSuppressionContext.Provider;

export function usePanelNavigationSuppression(navigationKey: string): boolean {
  const [paintedNavigationKey, setPaintedNavigationKey] = useState<string | null>(null);
  const suppressed = paintedNavigationKey !== navigationKey;

  useEffect(() => {
    if (!suppressed) return;
    let releaseFrame = 0;
    const paintFrame = window.requestAnimationFrame(() => {
      releaseFrame = window.requestAnimationFrame(() => setPaintedNavigationKey(navigationKey));
    });
    return () => {
      window.cancelAnimationFrame(paintFrame);
      window.cancelAnimationFrame(releaseFrame);
    };
  }, [navigationKey, suppressed]);

  return suppressed;
}

export function usePanelAnimationSettings(): {
  active: boolean;
  durationMs: number;
} {
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const suppressed = useContext(PanelAnimationSuppressionContext);
  const active = !prefersReducedMotion && !suppressed;
  return { active, durationMs: active ? PANEL_ANIMATION_DURATION_MS : 0 };
}

/** Keeps closing panel content mounted until its transition ends. */
export function usePanelPresence<T>(
  open: boolean,
  value: T | null,
  animated: boolean,
  scopeKey: string | null,
  durationMs: number,
): { present: boolean; value: T | null } {
  const [present, setPresent] = useState(open);
  const [retained, setRetained] = useState<{ scopeKey: string | null; value: T | null } | null>(
    open ? { scopeKey, value } : null,
  );

  if (open && (retained === null || retained.scopeKey !== scopeKey || retained.value !== value)) {
    setRetained({ scopeKey, value });
  }
  if (open ? !present : !animated && present) {
    setPresent(open);
  }

  useEffect(() => {
    if (open || !animated) return;
    const timeout = window.setTimeout(() => setPresent(false), durationMs);
    return () => window.clearTimeout(timeout);
  }, [animated, durationMs, open]);

  const retainedValue = retained?.scopeKey === scopeKey ? retained.value : null;
  const visible = open || (animated && present && retained?.scopeKey === scopeKey);
  return { present: visible, value: open ? value : visible ? retainedValue : null };
}
