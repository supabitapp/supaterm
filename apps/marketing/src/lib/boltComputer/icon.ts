import { bakeGlass, bakeScreenBase, context2d, makeCanvas } from "./bakes";
import { FACES, makeGrid } from "./faces";
import { DEFAULT_SETTINGS, hexToRgb, lookOf } from "./mount";
import { BoltComputerRenderer, LedPainter } from "./render";

/** The bolt's colour on each channel's app icon, keyed by its folder under `assets/`. */
export const ICON_PHOSPHORS = {
  prod: "#fff06a",
  nightly: "#da6aff",
  dev: "#6adaff",
} as const;

// At this pitch the bolt stays inside the 66dp safe circle of Android's 108dp adaptive canvas.
const SCREEN_ART_LEDS = 54;

/** The screen alone, filling `size` px square with the bolt lit in its middle. */
function paintScreenArt(size: number, phosphor: string) {
  const pitch = size / SCREEN_ART_LEDS;
  const grid = makeGrid(SCREEN_ART_LEDS + 2, SCREEN_ART_LEDS + 2);
  FACES.idle(grid, 0);
  const x0 = (size - pitch * grid.cols) / 2;
  const y0 = (size - pitch * grid.rows) / 2;
  const canvas = makeCanvas(size, size);
  const ctx = context2d(canvas);
  ctx.drawImage(bakeScreenBase(size, size, pitch, x0, y0), 0, 0);
  new LedPainter(grid.cols, grid.rows).paint(ctx, grid, pitch, x0, y0, hexToRgb(phosphor));
  ctx.drawImage(bakeGlass(size, size), 0, 0);
  return canvas;
}

const png = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/png");

/**
 * Every image the app icons are made from, as PNG data URLs keyed by channel: the front view's
 * layers at `layerSize` and the screen alone at `screenArtSize`.
 */
export function renderBrandIcons(layerSize: number, screenArtSize: number) {
  return Object.fromEntries(
    Object.entries(ICON_PHOSPHORS).map(([channel, phosphor]) => {
      const layers = new BoltComputerRenderer().paintIconLayers(
        layerSize,
        lookOf({ ...DEFAULT_SETTINGS, phosphor }),
      );
      return [
        channel,
        {
          housing: png(layers.housing),
          screen: png(layers.screen),
          bezel: png(layers.bezel),
          screenArt: png(paintScreenArt(screenArtSize, phosphor)),
        },
      ];
    }),
  );
}

/**
 * What the desktop app's launch animation is made from: the screen layer at `layerSize` with every
 * LED off, and where the bolt's first LED and the step to its neighbours fall on the layers, as
 * fractions of their size.
 */
export function renderLaunchIconArt(layerSize: number) {
  const renderer = new BoltComputerRenderer();
  const [x, y] = renderer.iconLedCenter(layerSize, 0, 0);
  const [nextX, nextY] = renderer.iconLedCenter(layerSize, 1, 1);
  return {
    unlitScreen: png(renderer.paintIconUnlitScreen(layerSize)),
    leds: {
      x: x / layerSize,
      y: y / layerSize,
      pitchX: (nextX - x) / layerSize,
      pitchY: (nextY - y) / layerSize,
    },
  };
}
