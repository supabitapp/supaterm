import { usePaneInputOwner } from "../../chatPanes/paneScope";
import { useEffect, useRef, useState } from "react";
import type { AssistantCitationRequest, AssistantCitationTarget } from "./AssistantCitationSource";
import type { CitationPhase } from "./citationProcedure";

const CITATION_SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

interface CitationNavigation {
  readonly target: AssistantCitationTarget;
  readonly activate: () => void;
  readonly retire: () => void;
  readonly attachDismissal: (viewport: HTMLElement | null) => () => void;
}

interface CitationSettlement {
  readonly target: AssistantCitationTarget;
  readonly dismissed: boolean;
}

export function useAssistantCitationTarget({
  request,
  phase,
  viewport,
  onManualNavigation,
}: {
  request: AssistantCitationRequest | null;
  phase: CitationPhase | null;
  viewport: HTMLElement | null;
  onManualNavigation: () => void;
}) {
  const isInputOwner = usePaneInputOwner();
  const [settlement, setSettlement] = useState<CitationSettlement | null>(null);
  const [listLoaded, setListLoaded] = useState(false);
  const onListLoad = () => setListLoaded(true);
  const [navigation, setNavigation] = useState<CitationNavigation | null>(null);
  let current = navigation;
  if ((request?.key ?? null) !== (navigation?.target.key ?? null)) {
    current = request ? createCitationNavigation(request) : null;
    setNavigation(current);
  }
  function createCitationNavigation(next: AssistantCitationRequest): CitationNavigation {
    let done = false;
    const activationRef: AssistantCitationTarget["activationRef"] = {
      current: { scrolled: false, dismissed: false },
    };
    const target: AssistantCitationTarget = {
      ...next,
      activationRef,
      onComplete: () => {
        done = true;
        onManualNavigation();
        setSettlement({ target, dismissed: false });
      },
    };
    const activate = () => {
      if (!done) onManualNavigation();
    };
    const retire = () => {
      activationRef.current.dismissed = true;
      activationRef.current.cancelScroll?.();
    };
    const attachDismissal = (citationViewport: HTMLElement | null) => {
      const dismiss = (onlyPending: boolean) => {
        const activation = activationRef.current;
        if (activation.dismissed || (onlyPending && (activation.scrolled || done))) return;
        activation.dismissed = true;
        activation.cancelScroll?.();
        if (!activation.scrolled && !done) onManualNavigation();
        done = true;
        setSettlement({ target, dismissed: true });
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && isInputOwner()) {
          dismiss(false);
        } else if (
          CITATION_SCROLL_KEYS.has(event.key) &&
          event.target instanceof Node &&
          citationViewport?.contains(event.target)
        ) {
          dismiss(true);
        }
      };
      const onWheel = (event: WheelEvent) => {
        if (event.deltaY !== 0) dismiss(true);
      };
      const onNavigation = (event: PointerEvent) => {
        if (event.target instanceof Node && citationViewport?.contains(event.target)) dismiss(true);
      };
      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("pointerdown", onNavigation, true);
      citationViewport?.addEventListener("wheel", onWheel, { passive: true });
      citationViewport?.addEventListener("touchmove", onNavigation, { passive: true });
      return () => {
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("pointerdown", onNavigation, true);
        citationViewport?.removeEventListener("wheel", onWheel);
        citationViewport?.removeEventListener("touchmove", onNavigation);
      };
    };
    return { target, activate, retire, attachDismissal };
  }
  const activatedRef = useRef<CitationNavigation | null>(null);
  useEffect(() => {
    if (activatedRef.current === current) return;
    activatedRef.current?.retire();
    activatedRef.current = current;
    current?.activate();
  }, [current]);
  useEffect(() => current?.attachDismissal(viewport), [current, viewport]);

  const settled = current !== null && settlement?.target === current.target ? settlement : null;
  const target =
    current !== null && phase?._tag === "ready" && listLoaded && settled?.dismissed !== true
      ? current.target
      : null;
  const positioning = current !== null && phase?._tag !== "failed" && settled === null;

  return {
    target,
    positioning,
    onListLoad,
    alwaysRender:
      target && positioning && phase?._tag === "ready" ? { keys: [phase.rowId] } : undefined,
  };
}
