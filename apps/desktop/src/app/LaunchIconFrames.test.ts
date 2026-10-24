import * as NodeServices from "@effect/platform-node/NodeServices";
import { BOLT_CELLS, thinkingLevel } from "@supaterm/shared/boltFace";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ledCenter, makeLaunchIconFrames } from "./LaunchIconFrames.ts";

const SIZE = 256;
const OFF = [12, 16, 14, 255] as const;
const ON = [250, 240, 110, 255] as const;

function iconPair() {
  const unlit = Buffer.alloc(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) unlit.set(OFF, i * 4);
  const lit = Buffer.from(unlit);
  for (const [c, r] of BOLT_CELLS) {
    const [u, v] = ledCenter(c, r);
    const x = Math.floor(u * SIZE);
    const y = Math.floor(v * SIZE);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) lit.set(ON, ((y + dy) * SIZE + x + dx) * 4);
    }
  }
  return { lit, unlit };
}

const redAt = (frame: Buffer, [u, v]: readonly [number, number]) =>
  frame[(Math.floor(v * SIZE) * SIZE + Math.floor(u * SIZE)) * 4] ?? 0;

describe("LaunchIconFrames", () => {
  it.effect("places every LED where the icon's artwork draws it", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const svg = yield* (yield* FileSystem.FileSystem).readFileString(
        path.resolve(
          import.meta.dirname,
          "../../../../assets/prod/app-icon.icon/Assets/05-Glass-Lightning.svg",
        ),
      );
      const [, tx, ty, scale, ox, oy] = (
        svg.match(
          /translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\) translate\(-([\d.]+) -([\d.]+)\)/,
        ) ?? []
      ).map(Number);
      const toTile = (svgUnits: number) => ((svgUnits / 80) * 824 + 100) / 1024;
      const drawn = [
        ...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g),
      ]
        .map((match) => match.slice(1).map(Number))
        .map(([x = 0, y = 0, w = 0, h = 0]) => [
          toTile((tx ?? 0) + (scale ?? 0) * (x + w / 2 - (ox ?? 0))),
          toTile((ty ?? 0) + (scale ?? 0) * (y + h / 2 - (oy ?? 0))),
        ]);

      assert.equal(drawn.length, BOLT_CELLS.length);
      for (const [c, r] of BOLT_CELLS) {
        const [u, v] = ledCenter(c, r);
        assert.isTrue(
          drawn.some(([x = 0, y = 0]) => Math.abs(x - u) < 1e-6 && Math.abs(y - v) < 1e-6),
          `no LED drawn at column ${c}, row ${r}`,
        );
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it("lands on the exact icon once the glow is back, so the Dock's handoff does not jump", () => {
    const { lit, unlit } = iconPair();
    const frames = makeLaunchIconFrames(lit, unlit, SIZE);

    frames.render(1.3, 0);

    assert.isTrue(frames.render(1.3, 1).equals(lit));
  });

  it("lights each LED at its own thinking level and leaves the rest of the icon alone", () => {
    const { lit, unlit } = iconPair();
    const frames = makeLaunchIconFrames(lit, unlit, SIZE);
    const t = 2.4;
    const byLevel = [...BOLT_CELLS].sort(
      ([ac, ar], [bc, br]) => thinkingLevel(bc, br, t) - thinkingLevel(ac, ar, t),
    );
    const [brightest = [0, 0], dimmest = [0, 0]] = [byLevel[0], byLevel.at(-1)];

    const frame = frames.render(t, 0);

    assert.isAbove(thinkingLevel(...brightest, t), 0.9);
    assert.isAbove(redAt(frame, ledCenter(...brightest)), OFF[0] + 0.85 * (ON[0] - OFF[0]));
    assert.isBelow(redAt(frame, ledCenter(...dimmest)), OFF[0] + 0.3 * (ON[0] - OFF[0]));
    assert.equal(redAt(frame, [0.1, 0.9]), OFF[0]);
  });
});
