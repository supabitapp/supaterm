import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ElectronApp from "./ElectronApp.ts";

type SymbolImage = ReturnType<ElectronApp.ElectronAppSystem["createFromNamedImage"]>;

function makeSystem(
  options: {
    readonly systemLocale?: string;
    readonly userDefaults?: ReadonlySet<string>;
    readonly symbols?: Array<(name: string) => SymbolImage>;
  } = {},
) {
  const symbolCalls: Array<[string, { readonly pointSize: number }]> = [];
  const symbols = [...(options.symbols ?? [])];
  const system: ElectronApp.ElectronAppSystem = {
    getSystemLocale: () => options.systemLocale ?? "en-GB",
    getUserDefault: (key) => options.userDefaults?.has(key) ?? false,
    createFromNamedImage: (name, imageOptions) => {
      symbolCalls.push([name, imageOptions]);
      const next = symbols.shift();
      if (next) return next(name);
      return {
        isEmpty: () => false,
        toDataURL: () => `data:image/png;base64,${name}`,
      };
    },
  };
  return {
    symbolCalls,
    layer: Layer.succeed(ElectronApp.ElectronApp, ElectronApp.makeWith(system)),
  };
}

describe("ElectronApp", () => {
  it.effect("loads the native Mac mini and Mac Studio symbols on macOS", () => {
    const fake = makeSystem();
    return Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;

      assert.deepEqual(yield* electronApp.environmentMachineIcons, {
        "mac-mini": "data:image/png;base64,macmini",
        "mac-studio": "data:image/png;base64,macstudio",
      });
      assert.deepEqual(fake.symbolCalls, [
        ["macmini", { pointSize: 32 }],
        ["macstudio", { pointSize: 32 }],
      ]);
    }).pipe(Effect.provide(fake.layer), Effect.provideService(HostProcess.Platform, "darwin"));
  });

  it.effect("keeps SVG fallbacks on Windows and Linux without loading Apple symbols", () => {
    const fake = makeSystem();
    return Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;

      assert.deepEqual(
        yield* electronApp.environmentMachineIcons.pipe(
          Effect.provideService(HostProcess.Platform, "win32"),
        ),
        {},
      );
      assert.deepEqual(
        yield* electronApp.environmentMachineIcons.pipe(
          Effect.provideService(HostProcess.Platform, "linux"),
        ),
        {},
      );
      assert.strictEqual(fake.symbolCalls.length, 0);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("omits an empty system symbol so the client uses its fallback", () => {
    const fake = makeSystem({
      symbols: [() => ({ isEmpty: () => true, toDataURL: () => "" })],
    });
    return Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;

      assert.deepEqual(yield* electronApp.environmentMachineIcons, {
        "mac-studio": "data:image/png;base64,macstudio",
      });
    }).pipe(Effect.provide(fake.layer), Effect.provideService(HostProcess.Platform, "darwin"));
  });

  it.effect("a failed native symbol does not prevent loading the other one", () => {
    const fake = makeSystem({
      symbols: [
        () => {
          throw new Error("symbol unavailable");
        },
      ],
    });
    return Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;

      assert.deepEqual(yield* electronApp.environmentMachineIcons, {
        "mac-studio": "data:image/png;base64,macstudio",
      });
    }).pipe(Effect.provide(fake.layer), Effect.provideService(HostProcess.Platform, "darwin"));
  });

  it("keeps the macOS region override and hour cycle in the locale tag", () => {
    assert.strictEqual(ElectronApp.toSystemLocaleTag("en_GB"), "en-GB");
    assert.strictEqual(ElectronApp.toSystemLocaleTag("en-US@rg=nlzzzz", "h12"), "en-NL-u-hc-h12");
    assert.strictEqual(ElectronApp.toSystemLocaleTag("en_US@rg=nlzzzz"), "en-NL");
    assert.strictEqual(ElectronApp.toSystemLocaleTag("en-GB", "h23"), "en-GB-u-hc-h23");
  });

  it("drops ICU keywords Intl cannot read instead of losing the whole locale", () => {
    assert.strictEqual(ElectronApp.toSystemLocaleTag("de_DE@calendar=buddhist"), "de-DE");
  });

  it.effect("follows LC_TIME on Linux when it differs from the language", () =>
    Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;
      const systemLocale = yield* electronApp.systemLocale.pipe(
        Effect.provideService(HostProcess.Platform, "linux"),
        Effect.provideService(HostProcess.Environment, {
          LANG: "en_US.UTF-8",
          LC_TIME: "de_DE.UTF-8",
        }),
      );

      assert.strictEqual(systemLocale, "de-DE");
    }).pipe(Effect.provide(makeSystem().layer)),
  );

  it.effect("falls back to Chromium's locale on Linux when the time locale is C", () =>
    Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;
      const systemLocale = yield* electronApp.systemLocale.pipe(
        Effect.provideService(HostProcess.Platform, "linux"),
        Effect.provideService(HostProcess.Environment, { LANG: "C.UTF-8" }),
      );

      assert.strictEqual(systemLocale, "fr-FR");
    }).pipe(Effect.provide(makeSystem({ systemLocale: "fr-FR" }).layer)),
  );
});

it.effect("reads both macOS hour preferences without overriding explicit formats", () =>
  Effect.gen(function* () {
    for (const [preference, expected] of [
      ["AppleICUForce12HourTime", "en-NL-u-hc-h12"],
      ["AppleICUForce24HourTime", "en-NL-u-hc-h23"],
      ["", "en-NL"],
    ]) {
      const locale = yield* ElectronApp.makeWith({
        getSystemLocale: () => "en_US@rg=nlzzzz",
        getUserDefault: (key) => key === preference,
        createFromNamedImage: () => ({ isEmpty: () => true, toDataURL: () => "" }),
      }).systemLocale.pipe(Effect.provideService(HostProcess.Platform, "darwin"));
      assert.strictEqual(locale, expected);
      for (const hour12 of [true, false]) {
        assert.strictEqual(
          new Intl.DateTimeFormat(locale, { hour: "numeric", hour12 }).resolvedOptions().hour12,
          hour12,
        );
      }
    }
  }),
);
