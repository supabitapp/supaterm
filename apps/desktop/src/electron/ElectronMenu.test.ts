import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Electron from "electron";

import * as ElectronMenu from "./ElectronMenu.ts";

const makeWindow = (zoomFactor = 1) =>
  ({
    id: 7,
    webContents: { getZoomFactor: () => zoomFactor },
  }) as unknown as Electron.BrowserWindow;

describe("ElectronMenu", () => {
  it.effect("keeps mapped icon keywords as native icons on macOS", () => {
    const templates: Array<Array<Electron.MenuItemConstructorOptions>> = [];
    const native: ElectronMenu.ElectronMenuNative = {
      createFromNamedImage: (name) => ({
        resize: () =>
          ({
            name,
            isEmpty: () => false,
            setTemplateImage: () => {},
          }) as unknown as Electron.NativeImage,
      }),
      buildFromTemplate: (template) => {
        templates.push(template);
        return { popup: (options) => options?.callback?.() };
      },
      setApplicationMenu: () => undefined,
    };
    return Effect.gen(function* () {
      const electronMenu = yield* ElectronMenu.ElectronMenu;
      yield* electronMenu.showContextMenu({
        window: makeWindow(),
        items: [
          { id: "feedback", label: "Send feedback", icon: "message-square-text" },
          { id: "rename", label: "Rename", icon: "pencil" },
          { id: "delete", label: "Delete", icon: "trash", destructive: true },
        ],
        position: Option.none(),
        source: Option.none(),
      });

      assert.deepEqual(
        templates[0]?.map(
          (item) => (item.icon as { readonly name?: string } | undefined)?.name ?? null,
        ),
        ["text.bubble", null, null, "trash"],
      );
    }).pipe(
      Effect.provide(
        Layer.effect(ElectronMenu.ElectronMenu, ElectronMenu.makeWith(native)).pipe(
          Layer.provide(Layer.succeed(HostProcess.Platform, "darwin")),
        ),
      ),
    );
  });
});
