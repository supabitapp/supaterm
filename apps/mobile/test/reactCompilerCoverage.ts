// @effect-diagnostics nodeBuiltinImport:off - compiles real source files on disk.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

export const mobileRoot = NodePath.resolve(__dirname, "..");
export const requireFromMobile = NodeModule.createRequire(
  NodePath.join(mobileRoot, "package.json"),
);
const babel: {
  transformFileSync: (file: string, options: Record<string, unknown>) => unknown;
} = requireFromMobile("@babel/core");

// Remove bailout entries and manual memoization when compilation starts; this check rejects stale entries.
export const KNOWN_BAILOUTS: Record<string, string> = {
  "src/features/threads/ThreadArrangementSheet.tsx": "unsupported syntax",
  "src/native/SupatermComposerEditor.ios.tsx": "ref read during render",
  "src/native/SupatermComposerEditor.native.tsx": "ref read during render",
};

// Use Metro's iOS release flags; experiments.reactCompiler enables supportsReactCompiler.
const metroCaller = {
  name: "metro",
  bundler: "metro",
  platform: "ios",
  isDev: false,
  isServer: false,
  isNodeModule: false,
  supportsStaticESM: true,
  supportsReactCompiler: true,
};

export const sourceFiles = NodeFS.readdirSync(NodePath.join(mobileRoot, "src"), { recursive: true })
  .map(String)
  .filter((file) => /\.tsx?$/.test(file) && !/\.(test\.tsx?|d\.ts)$/.test(file))
  .map((file) => `src/${file.split(NodePath.sep).join("/")}`)
  .sort();

type CompilerLoc = { readonly start?: { readonly line?: number } } | null;

export interface CompilerEvent {
  readonly kind: string;
  readonly detail?: {
    readonly options?: {
      readonly category?: string;
      readonly reason?: string;
      readonly loc?: CompilerLoc;
      readonly details?: readonly { readonly loc?: CompilerLoc }[];
    };
  };
}

// babel.config.js is the file Metro loads; the logger rides on the preset's
// own react-compiler option so the plugin runs with Metro's exact settings.
export function compileLikeMetro(
  file: string,
  events: CompilerEvent[],
  output: Record<string, unknown>,
) {
  const babelConfig = requireFromMobile("./babel.config.js")({ cache: () => {} });
  const presets = babelConfig.presets.map(([name, options]: [string, object]) =>
    name === "babel-preset-expo"
      ? [
          requireFromMobile.resolve(name),
          {
            ...options,
            "react-compiler": {
              logger: { logEvent: (_: string, event: CompilerEvent) => events.push(event) },
            },
          },
        ]
      : [name, options],
  );
  return babel.transformFileSync(NodePath.join(mobileRoot, file), {
    babelrc: false,
    configFile: false,
    cwd: mobileRoot,
    presets,
    caller: metroCaller,
    code: false,
    ...output,
  });
}

function compilerBailouts(file: string): string[] {
  const events: CompilerEvent[] = [];
  compileLikeMetro(file, events, {});
  return events.flatMap((event) =>
    event.kind === "CompileError" || event.kind === "CompileSkip"
      ? [
          `line ${(event.detail?.options?.loc ?? event.detail?.options?.details?.[0]?.loc)?.start?.line ?? "?"}: ${event.detail?.options?.category ?? event.kind} ${event.detail?.options?.reason ?? ""}`,
        ]
      : [],
  );
}

// One sweep compiles about a thousand files on one thread, so the slices run as separate files.
export function describeCompileSweep(slice: number, slices: number) {
  describe(`React Compiler sweep ${slice}/${slices}`, () => {
    it.each(sourceFiles.filter((_, index) => index % slices === slice - 1))(
      "compiles %s",
      (file) => {
        const bailouts = compilerBailouts(file);
        if (file in KNOWN_BAILOUTS) {
          expect(bailouts, `${file} compiles now; remove it from KNOWN_BAILOUTS`).not.toEqual([]);
        } else {
          expect(bailouts).toEqual([]);
        }
      },
    );
  });
}
