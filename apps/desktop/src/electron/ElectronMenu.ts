import type { ContextMenuItem } from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

export interface ElectronMenuPosition {
  readonly x: number;
  readonly y: number;
}

export interface ElectronMenuContextInput {
  readonly window: Electron.BrowserWindow;
  readonly items: readonly ContextMenuItem[];
  readonly position: Option.Option<ElectronMenuPosition>;
}

export interface ElectronMenuTemplateInput {
  readonly window: Electron.BrowserWindow;
  readonly template: readonly Electron.MenuItemConstructorOptions[];
  readonly frame?: Electron.WebFrameMain;
}

const ElectronMenuOperation = Schema.Literals([
  "set-application-menu",
  "popup-template",
  "show-context-menu",
]);

export class ElectronMenuOperationError extends Schema.TaggedError<ElectronMenuOperationError>()(
  "ElectronMenuOperationError",
  {
    operation: ElectronMenuOperation,
    platform: Schema.String,
    windowId: Schema.NullOr(Schema.Number),
    itemCount: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const window = this.windowId === null ? "" : ` for window ${this.windowId}`;
    return `Electron menu operation ${JSON.stringify(this.operation)} failed${window} with ${this.itemCount} items on ${this.platform}.`;
  }
}

export class ElectronMenu extends Context.Service<
  ElectronMenu,
  {
    readonly setApplicationMenu: (
      template: readonly Electron.MenuItemConstructorOptions[],
    ) => Effect.Effect<void>;
    readonly showContextMenu: (
      input: ElectronMenuContextInput,
    ) => Effect.Effect<Option.Option<string>>;
    readonly popupTemplate: (input: ElectronMenuTemplateInput) => Effect.Effect<void>;
  }
>()("@supaterm/desktop/electron/ElectronMenu") {}

function normalizeContextMenuItems(source: readonly ContextMenuItem[]): ContextMenuItem[] {
  const normalizedItems: ContextMenuItem[] = [];

  for (const sourceItem of source) {
    if (typeof sourceItem.id !== "string" || typeof sourceItem.label !== "string") {
      continue;
    }

    // Header items are decorative section labels for the web fallback only —
    // Electron's native menu has no equivalent affordance, so we skip them.
    if (sourceItem.header === true) {
      continue;
    }

    const normalizedItem: ContextMenuItem = {
      id: sourceItem.id,
      label: sourceItem.label,
      destructive: sourceItem.destructive === true,
      disabled: sourceItem.disabled === true,
      ...(typeof sourceItem.icon === "string" ? { icon: sourceItem.icon } : {}),
      ...(sourceItem.separatorBefore === true ? { separatorBefore: true } : {}),
      ...(typeof sourceItem.checked === "boolean" ? { checked: sourceItem.checked } : {}),
    };

    if (sourceItem.children) {
      const normalizedChildren = normalizeContextMenuItems(sourceItem.children);
      if (normalizedChildren.length === 0) {
        continue;
      }
      normalizedItem.children = normalizedChildren;
    }

    normalizedItems.push(normalizedItem);
  }

  return normalizedItems;
}

// Renderer positions arrive in CSS pixels; popup() expects window points, so
// page zoom must be factored in or menus drift proportionally to their
// distance from the window origin.
const normalizePosition = (
  position: Option.Option<ElectronMenuPosition>,
  zoomFactor: number,
): Option.Option<ElectronMenuPosition> =>
  Option.filter(
    position,
    ({ x, y }) =>
      Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && Number.isFinite(zoomFactor),
  ).pipe(
    Option.map(({ x, y }) => ({ x: Math.floor(x * zoomFactor), y: Math.floor(y * zoomFactor) })),
  );

const MENU_ICON_SYMBOLS: Readonly<Record<string, string>> = {
  globe: "globe",
  "message-square-text": "text.bubble",
  trash: "trash",
};

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const menuIconCache = new Map<string, Option.Option<Electron.NativeImage>>();

  const loadMenuIcon = (symbol: string): Option.Option<Electron.NativeImage> => {
    try {
      const image = Electron.nativeImage.createFromNamedImage(symbol).resize({ height: 12 });
      image.setTemplateImage(true);
      return image.isEmpty() ? Option.none() : Option.some(image);
    } catch {
      return Option.none();
    }
  };

  const getMenuIcon = (symbol: string): Option.Option<Electron.NativeImage> => {
    if (platform !== "darwin") {
      return Option.none();
    }
    let icon = menuIconCache.get(symbol);
    if (icon === undefined) {
      icon = loadMenuIcon(symbol);
      menuIconCache.set(symbol, icon);
    }
    return icon;
  };

  const buildTemplate = (
    entries: readonly ContextMenuItem[],
    complete: (selectedItemId: Option.Option<string>) => void,
  ): Electron.MenuItemConstructorOptions[] => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    let hasInsertedDestructiveSeparator = false;
    let sectionStartedByExplicitSeparator = false;
    const appendSeparator = () => {
      if (template.length === 0 || template.at(-1)?.type === "separator") return;
      template.push({ type: "separator" });
    };

    for (const item of entries) {
      if (item.separatorBefore) {
        appendSeparator();
        sectionStartedByExplicitSeparator = true;
      }
      if (
        item.destructive &&
        !hasInsertedDestructiveSeparator &&
        !sectionStartedByExplicitSeparator &&
        template.length > 0
      ) {
        appendSeparator();
        hasInsertedDestructiveSeparator = true;
      }

      const itemOption: Electron.MenuItemConstructorOptions = {
        label: item.label,
        enabled: !item.disabled,
        ...(typeof item.checked === "boolean" ? { type: "checkbox", checked: item.checked } : {}),
      };
      if (item.children && item.children.length > 0) {
        itemOption.submenu = buildTemplate(item.children, complete);
      } else {
        itemOption.click = () => complete(Option.some(item.id));
      }
      const keyword = item.destructive && itemOption.submenu === undefined ? "trash" : item.icon;
      const symbol = keyword === undefined ? undefined : MENU_ICON_SYMBOLS[keyword];
      if (symbol !== undefined) {
        const icon = getMenuIcon(symbol);
        if (Option.isSome(icon)) {
          itemOption.icon = icon.value;
        }
      }

      template.push(itemOption);
    }

    return template;
  };

  return ElectronMenu.of({
    setApplicationMenu: (template) =>
      Effect.try({
        try: () => {
          Electron.Menu.setApplicationMenu(Electron.Menu.buildFromTemplate([...template]));
        },
        catch: (cause) =>
          new ElectronMenuOperationError({
            operation: "set-application-menu",
            platform,
            windowId: null,
            itemCount: template.length,
            cause,
          }),
      }).pipe(Effect.orDie),
    popupTemplate: (input) =>
      input.template.length === 0
        ? Effect.void
        : Effect.try({
            try: () =>
              Electron.Menu.buildFromTemplate([...input.template]).popup({
                window: input.window,
                ...(input.frame ? { frame: input.frame } : {}),
              }),
            catch: (cause) =>
              new ElectronMenuOperationError({
                operation: "popup-template",
                platform,
                windowId: input.window.id,
                itemCount: input.template.length,
                cause,
              }),
          }).pipe(Effect.orDie),
    showContextMenu: (input) =>
      Effect.callback<Option.Option<string>>((resume) => {
        const normalizedItems = normalizeContextMenuItems(input.items);
        if (normalizedItems.length === 0) {
          resume(Effect.succeedNone);
          return;
        }

        let completed = false;
        const complete = (selectedItemId: Option.Option<string>) => {
          if (completed) {
            return;
          }
          completed = true;
          resume(Effect.succeed(selectedItemId));
        };

        try {
          const menu = Electron.Menu.buildFromTemplate(buildTemplate(normalizedItems, complete));
          const popupPosition = normalizePosition(
            input.position,
            input.window.webContents.getZoomFactor(),
          );
          const popupOptions = Option.match(popupPosition, {
            onNone: (): Electron.PopupOptions => ({
              window: input.window,
              callback: () => complete(Option.none()),
            }),
            onSome: (position): Electron.PopupOptions => ({
              window: input.window,
              x: position.x,
              y: position.y,
              callback: () => complete(Option.none()),
            }),
          });
          menu.popup(popupOptions);
        } catch (cause) {
          if (completed) {
            return;
          }
          completed = true;
          resume(
            Effect.die(
              new ElectronMenuOperationError({
                operation: "show-context-menu",
                platform,
                windowId: input.window.id,
                itemCount: normalizedItems.length,
                cause,
              }),
            ),
          );
        }
      }),
  });
});

export const layer = Layer.effect(ElectronMenu, make);
