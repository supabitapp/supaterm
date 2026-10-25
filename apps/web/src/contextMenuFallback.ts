import type { ContextMenuItem } from "@supaterm/contracts";
import {
  Archive,
  Check,
  ChevronRight,
  CircleCheck,
  Clock,
  Columns,
  Copy,
  Folder,
  FolderTree,
  GitBranch,
  Globe,
  Hash,
  iconSvgElements,
  type IconNode,
  MailUnread,
  MessageSquarePlus,
  MessageSquareText,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Settings,
  Timer,
  Trash,
} from "@supaterm/icons/nodes";

const SVG_NS = "http://www.w3.org/2000/svg";

// Keys are the `icon` names callers put on context menu items; desktop maps the same
// names to native symbols.
const ICONS: Readonly<Record<string, IconNode>> = {
  archive: Archive,
  check: Check,
  timer: Timer,
  "chevron-right": ChevronRight,
  "columns-2": Columns,
  "circle-check": CircleCheck,
  clock: Clock,
  pencil: Pencil,
  copy: Copy,
  folder: Folder,
  "git-branch": GitBranch,
  hash: Hash,
  "mail-open": MailUnread,
  globe: Globe,
  "message-square-plus": MessageSquarePlus,
  "message-square-text": MessageSquareText,
  pin: Pin,
  "pin-off": PinOff,
  "refresh-cw": RefreshCw,
  settings: Settings,
  "folder-tree": FolderTree,
  trash: Trash,
};

function createIconElement(name: string, tone: "neutral" | "destructive"): SVGSVGElement | null {
  const node = ICONS[name];
  if (!node || typeof document.createElementNS !== "function") {
    return null;
  }
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute(
    "class",
    tone === "destructive"
      ? "size-4.5 shrink-0 sm:size-4"
      : "size-4.5 shrink-0 text-muted-foreground sm:size-4",
  );
  svg.innerHTML = iconSvgElements(node);
  return svg;
}

function clampMenuPosition(
  menu: HTMLDivElement,
  preferredLeft: number,
  preferredTop: number,
  openUpwardWhenCramped = false,
) {
  const rect = menu.getBoundingClientRect();
  if (openUpwardWhenCramped && preferredTop + rect.height > window.innerHeight - 4) {
    preferredTop -= rect.height;
  }
  const left = Math.min(
    Math.max(4, preferredLeft),
    Math.max(4, window.innerWidth - rect.width - 4),
  );
  const top = Math.min(
    Math.max(4, preferredTop),
    Math.max(4, window.innerHeight - rect.height - 4),
  );
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function isNodeWithinMenuStack(target: EventTarget | null, menuStack: readonly HTMLDivElement[]) {
  if (typeof Node !== "undefined" && target instanceof Node) {
    return menuStack.some((menu) => menu.contains(target));
  }
  if (!target || typeof target !== "object") {
    return false;
  }

  let current: unknown = target;
  while (current && typeof current === "object") {
    if (menuStack.includes(current as HTMLDivElement)) {
      return true;
    }
    current = (current as { parent?: unknown }).parent;
  }
  return false;
}

let activeContextMenuDismiss: (() => void) | null = null;

export function isContextMenuOpen(): boolean {
  return activeContextMenuDismiss !== null;
}

export function dismissContextMenu(): void {
  activeContextMenuDismiss?.();
  activeContextMenuDismiss = null;
}

export function showContextMenuFallback<T extends string>(
  items: readonly ContextMenuItem<T>[],
  position?: { x: number; y: number },
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menuStack: HTMLDivElement[] = [];
    const submenuTriggerStack: Array<HTMLButtonElement | undefined> = [];
    let isDisposed = false;
    let canDismissFromPointer = false;

    const dismiss = () => cleanup(null);

    const cleanup = (result: T | null) => {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      if (activeContextMenuDismiss === dismiss) {
        activeContextMenuDismiss = null;
      }
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      const shouldRestoreFocus = isNodeWithinMenuStack(document.activeElement, menuStack);
      for (const menu of menuStack) {
        menu.remove();
      }
      if (shouldRestoreFocus && previouslyFocusedElement?.isConnected) {
        previouslyFocusedElement.focus({ preventScroll: true });
      }
      resolve(result);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup(null);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!canDismissFromPointer || isNodeWithinMenuStack(event.target, menuStack)) {
        return;
      }
      cleanup(null);
    };

    const onContextMenu = (event: MouseEvent) => {
      if (!canDismissFromPointer || isNodeWithinMenuStack(event.target, menuStack)) {
        return;
      }
      event.preventDefault();
      cleanup(null);
    };

    const closeMenusFromLevel = (level: number) => {
      while (menuStack.length > level) {
        submenuTriggerStack.pop()?.setAttribute("aria-expanded", "false");
        menuStack.pop()?.remove();
      }
    };

    const openMenu = (
      entries: readonly ContextMenuItem<T>[],
      preferredLeft: number,
      preferredTop: number,
      level: number,
      parentTrigger?: HTMLButtonElement,
    ) => {
      closeMenusFromLevel(level);

      const menu = document.createElement("div");
      menu.className =
        "dropdown-glass fixed z-[10000] min-w-32 max-w-sm overflow-hidden rounded-lg bg-clip-padding text-popover-foreground outline-none";
      menu.style.cssText =
        "position:fixed;z-index:10000;min-width:8rem;max-width:24rem;overflow:hidden;border-radius:var(--radius-lg);background-clip:padding-box;color:var(--contrast-popover-foreground);outline:none;pointer-events:auto;";
      menu.style.left = `${preferredLeft}px`;
      menu.style.top = `${preferredTop}px`;
      menu.dataset.level = String(level);

      const inner = document.createElement("div");
      inner.className =
        "max-h-[calc(100vh-0.5rem)] min-w-0 max-w-sm overflow-y-auto overflow-x-hidden p-1";
      inner.style.cssText =
        "max-height:calc(100vh - 0.5rem);min-width:0;max-width:24rem;overflow-x:hidden;overflow-y:auto;padding:0.25rem;";

      for (const item of entries) {
        if (item.separatorBefore === true && inner.children.length > 0) {
          const separator = document.createElement("div");
          separator.className = "mx-2 my-1 h-px bg-border";
          separator.style.cssText =
            "height:1px;margin:0.25rem 0.5rem;background:var(--contrast-border);";
          separator.dataset.contextMenuSeparator = "true";
          separator.setAttribute("role", "separator");
          inner.appendChild(separator);
        }

        if (item.header === true) {
          const header = document.createElement("div");
          header.className = "px-2 py-1.5 font-medium text-muted-foreground text-xs";
          header.textContent = item.label;
          inner.appendChild(header);
          continue;
        }

        const hasChildren = Array.isArray(item.children) && item.children.length > 0;
        const isLeafDestructive =
          !hasChildren && (item.destructive === true || item.id === ("delete" as T));

        const button = document.createElement("button");
        button.type = "button";
        const isDisabled = item.disabled === true;
        button.disabled = isDisabled;
        const rowBase =
          "flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1 text-left outline-none transition-colors sm:min-h-7 sm:text-sm min-h-8 text-base";
        button.className = isDisabled
          ? `${rowBase} pointer-events-none cursor-not-allowed text-muted-foreground opacity-64`
          : isLeafDestructive
            ? `${rowBase} text-destructive-foreground hover:bg-destructive/10 hover:text-destructive-foreground`
            : `${rowBase} text-foreground hover:bg-accent hover:text-accent-foreground`;
        button.style.cssText =
          "display:flex;width:100%;min-height:1.75rem;align-items:center;gap:0.5rem;border:0;border-radius:var(--radius-sm);background:transparent;padding:0.25rem 0.5rem;color:var(--contrast-foreground);font-family:var(--font-sans,system-ui,sans-serif);font-size:0.875rem;line-height:1.25rem;text-align:left;cursor:default;";
        if (isLeafDestructive) {
          button.style.color = "var(--destructive-foreground)";
        }
        if (isDisabled) {
          button.style.color = "var(--contrast-muted-foreground)";
          button.style.opacity = "0.64";
          button.style.pointerEvents = "none";
        }

        if (typeof item.checked === "boolean") {
          button.setAttribute("role", "menuitemradio");
          button.setAttribute("aria-checked", item.checked ? "true" : "false");
          const check = item.checked ? createIconElement("check", "neutral") : null;
          if (check) {
            button.appendChild(check);
          } else {
            const spacer = document.createElement("span");
            spacer.className = "size-4.5 shrink-0 sm:size-4";
            spacer.style.cssText = "display:inline-block;width:1rem;height:1rem;flex-shrink:0;";
            spacer.setAttribute("aria-hidden", "true");
            button.appendChild(spacer);
          }
        } else if (typeof item.icon === "string") {
          const icon = createIconElement(item.icon, isLeafDestructive ? "destructive" : "neutral");
          if (icon) {
            button.appendChild(icon);
          }
        }

        const label = document.createElement("span");
        label.className = "min-w-0 flex-1 truncate";
        label.textContent = item.label;
        button.appendChild(label);

        if (hasChildren) {
          button.setAttribute("aria-haspopup", "menu");
          button.setAttribute("aria-expanded", "false");
          const chevron = createIconElement("chevron-right", "neutral");
          if (chevron) {
            chevron.setAttribute(
              "class",
              "-me-0.5 ms-auto size-4.5 shrink-0 text-muted-foreground opacity-80 sm:size-4",
            );
            chevron.setAttribute("aria-hidden", "true");
            chevron.dataset.contextMenuChevron = "true";
            button.appendChild(chevron);
          }
        }

        if (!isDisabled) {
          let isHovered = false;
          let isFocused = false;
          const updateHighlight = () => {
            const isHighlighted = isHovered || isFocused;
            button.style.background = isHighlighted
              ? isLeafDestructive
                ? "color-mix(in srgb, var(--destructive) 10%, transparent)"
                : "var(--accent)"
              : "transparent";
            button.style.color = isHighlighted
              ? isLeafDestructive
                ? "var(--destructive-foreground)"
                : "var(--contrast-accent-foreground)"
              : isLeafDestructive
                ? "var(--destructive-foreground)"
                : "var(--contrast-foreground)";
          };
          button.addEventListener("mouseenter", () => {
            button.focus({ preventScroll: true });
            isHovered = true;
            updateHighlight();
          });
          button.addEventListener("mouseleave", () => {
            isHovered = false;
            updateHighlight();
          });
          button.addEventListener("focus", () => {
            isFocused = true;
            updateHighlight();
          });
          button.addEventListener("blur", () => {
            isFocused = false;
            updateHighlight();
          });

          if (hasChildren) {
            const openSubmenu = (focusFirstItem = false) => {
              const rect = button.getBoundingClientRect();
              const nextLeft = rect.right + 4;
              const nextTop = rect.top;
              openMenu(item.children!, nextLeft, nextTop, level + 1, button);
              button.setAttribute("aria-expanded", "true");

              const childMenu = menuStack[level + 1];
              if (!childMenu) {
                return;
              }
              const childRect = childMenu.getBoundingClientRect();
              if (childRect.right > window.innerWidth) {
                clampMenuPosition(childMenu, rect.left - childRect.width - 4, rect.top);
              }
              if (focusFirstItem) {
                [...childMenu.querySelectorAll<HTMLButtonElement>("button")]
                  .find((childButton) => !childButton.disabled)
                  ?.focus();
              }
            };
            button.addEventListener("mouseenter", () => {
              openSubmenu();
            });
            button.addEventListener("click", (event) => {
              event.preventDefault();
              openSubmenu(true);
            });
          } else {
            button.addEventListener("mouseenter", () => {
              closeMenusFromLevel(level + 1);
            });
            button.addEventListener("click", () => {
              if (canDismissFromPointer) cleanup(item.id);
            });
          }
        }

        inner.appendChild(button);
      }

      menu.appendChild(inner);

      menu.addEventListener("mouseenter", () => {
        closeMenusFromLevel(level + 1);
      });

      document.body.appendChild(menu);
      menuStack[level] = menu;
      submenuTriggerStack[level] = parentTrigger;

      requestAnimationFrame(() => {
        clampMenuPosition(menu, preferredLeft, preferredTop, level === 0);
      });
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    openMenu(items, position?.x ?? 0, position?.y ?? 0, 0);
    // Dismiss the prior menu before replacing its only cleanup handle, or its DOM and listeners leak.
    if (activeContextMenuDismiss) {
      activeContextMenuDismiss();
    }
    activeContextMenuDismiss = dismiss;

    requestAnimationFrame(() => {
      canDismissFromPointer = true;
    });
  });
}
