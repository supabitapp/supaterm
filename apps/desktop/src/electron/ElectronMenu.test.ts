import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Electron from "electron";
import { beforeEach, vi } from "vite-plus/test";

const { buildFromTemplateMock, createFromNamedImageMock, setApplicationMenuMock } = vi.hoisted(
  () => ({
    buildFromTemplateMock: vi.fn(),
    createFromNamedImageMock: vi.fn(),
    setApplicationMenuMock: vi.fn(),
  }),
);

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: buildFromTemplateMock,
    setApplicationMenu: setApplicationMenuMock,
  },
  nativeImage: {
    createFromNamedImage: createFromNamedImageMock,
  },
}));

import * as ElectronMenu from "./ElectronMenu.ts";

const makeWindow = (zoomFactor = 1): Electron.BrowserWindow =>
  ({
    id: 7,
    webContents: { getZoomFactor: () => zoomFactor },
  }) as unknown as Electron.BrowserWindow;

describe("ElectronMenu", () => {
  beforeEach(() => {
    buildFromTemplateMock.mockReset();
    createFromNamedImageMock.mockReset();
    setApplicationMenuMock.mockReset();
  });

  it.effect("keeps mapped icon keywords as native icons on macOS", () =>
    Effect.gen(function* () {
      const symbol = (name: string) => ({
        name,
        isEmpty: () => false,
        setTemplateImage: () => {},
      });
      createFromNamedImageMock.mockImplementation((name: string) => ({
        resize: () => symbol(name),
      }));
      buildFromTemplateMock.mockImplementation(() => ({
        popup: (options: Electron.PopupOptions) => options.callback?.(),
      }));

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
        buildFromTemplateMock.mock.calls[0]?.[0].map(
          (item: Electron.MenuItemConstructorOptions & { icon?: { name: string } }) =>
            item.icon?.name ?? null,
        ),
        ["text.bubble", null, null, "trash"],
      );
    }).pipe(
      Effect.provide(
        ElectronMenu.layer.pipe(Layer.provide(Layer.succeed(HostProcess.Platform, "darwin"))),
      ),
    ),
  );

  it.effect("shows ampersands in labels instead of reading them as mnemonics", () =>
    Effect.gen(function* () {
      buildFromTemplateMock.mockImplementation(() => ({
        popup: (options: Electron.PopupOptions) => options.callback?.(),
      }));
      const electronMenu = yield* ElectronMenu.ElectronMenu;
      yield* electronMenu.showContextMenu({
        window: makeWindow(),
        items: [
          { id: "filter", label: "Filter by R&D" },
          { id: "more", label: "A&B", children: [{ id: "child", label: "C && D" }] },
        ],
        position: Option.none(),
        source: Option.none(),
      });

      const template = buildFromTemplateMock.mock.calls[0]?.[0] as
        | Electron.MenuItemConstructorOptions[]
        | undefined;
      assert.deepEqual(
        template?.map((item) => item.label),
        ["Filter by R&&D", "A&&B"],
      );
      const submenu = template?.[1]?.submenu as Electron.MenuItemConstructorOptions[];
      assert.equal(submenu[0]!.label, "C &&&& D");
    }).pipe(
      Effect.provide(
        ElectronMenu.layer.pipe(Layer.provide(Layer.succeed(HostProcess.Platform, "win32"))),
      ),
    ),
  );
});
