// @effect-diagnostics nodeBuiltinImport:off - compiles real source files on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  KNOWN_BAILOUTS,
  compileLikeMetro,
  mobileRoot,
  requireFromMobile,
  sourceFiles,
} from "../test/reactCompilerCoverage";

const metroConfig: Promise<{ transformer: { babelTransformerPath: string } }> =
  requireFromMobile("./metro.config.js");

interface AstNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

const isAstNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

function walkAst(
  value: unknown,
  visit: (node: AstNode, ancestors: readonly AstNode[]) => void,
  ancestors: readonly AstNode[] = [],
) {
  if (typeof value !== "object" || value === null) return;
  const node = isAstNode(value) ? value : null;
  if (node) visit(node, ancestors);
  const childAncestors = node ? [...ancestors, node] : ancestors;
  for (const child of Object.values(value)) walkAst(child, visit, childAncestors);
}

// For each call to `callee`, whether it runs only on the cache-miss branch of
// an `if ($[n] !== dep)` block rather than on every render.
function compilerCachedCalls(file: string, callee: string): boolean[] {
  const result = compileLikeMetro(file, [], { ast: true });
  const cached: boolean[] = [];
  if (typeof result !== "object" || result === null || !("ast" in result)) return cached;
  walkAst(result.ast, (node, ancestors) => {
    if (node.type !== "CallExpression" || !isAstNode(node.callee)) return;
    if (node.callee.type !== "Identifier" || node.callee.name !== callee) return;
    cached.push(
      ancestors.some(
        (ancestor, index) =>
          ancestor.type === "IfStatement" &&
          ancestors[index + 1] === ancestor.consequent &&
          JSON.stringify(ancestor.test).includes('"name":"$"'),
      ),
    );
  });
  return cached;
}

describe("React Compiler coverage", () => {
  it("Metro's transformer applies the compiler", async () => {
    const { transformer } = await metroConfig;
    const metroTransformer = requireFromMobile(transformer.babelTransformerPath);
    const filename = NodePath.join(
      mobileRoot,
      "src/features/archive/ArchivedThreadsRouteScreen.tsx",
    );
    const transformed = (reactCompiler: string) => {
      const { ast } = metroTransformer.transform({
        filename,
        src: NodeFS.readFileSync(filename, "utf8"),
        plugins: [],
        options: {
          dev: false,
          hot: false,
          platform: "ios",
          projectRoot: mobileRoot,
          type: "module",
          enableBabelRCLookup: false,
          experimentalImportSupport: false,
          customTransformOptions: { reactCompiler, routerRoot: "app" },
        },
      });
      return JSON.stringify(ast.program.body);
    };
    expect(transformed("true")).toContain("react/compiler-runtime");
    expect(transformed("false")).not.toContain("react/compiler-runtime");
  });

  // The compiler once silently dropped this cache, so every
  // ThreadFeed render rebuilt the feed and handed LegendList a new data array.
  it("caches the thread feed derivation", () => {
    expect(
      compilerCachedCalls("src/features/threads/ThreadFeed.tsx", "deriveThreadFeedPresentation"),
    ).toEqual([true]);
  });

  // The compiler once silently dropped these caches, so the new-task context
  // value changed on every provider render and re-rendered every consumer.
  it("caches the new-task model options and host environments", () => {
    const file = "src/features/threads/new-task-flow-provider.tsx";
    expect(compilerCachedCalls(file, "buildModelOptions")).toEqual([true]);
    expect(compilerCachedCalls(file, "repositoryGroupingKeyOf")).toEqual([true, true]);
  });

  // Uncached facets get a new identity every render, and the render-phase facet merge then loops.
  it("caches the pull request list facets", () => {
    expect(
      compilerCachedCalls(
        "src/features/pull-requests/PullRequestsScreen.tsx",
        "pullRequestListFacets",
      ),
    ).toEqual([true]);
  });

  // An uncached registration would re-register the workspace inspector on every render.
  it("registers the workspace inspector only when its renderer changes", () => {
    expect(
      compilerCachedCalls(
        "src/features/layout/AdaptiveWorkspaceLayout.tsx",
        "registerWorkspaceInspector",
      ),
    ).toEqual([true]);
  });

  it("lists only files that exist", () => {
    expect(Object.keys(KNOWN_BAILOUTS).filter((file) => !sourceFiles.includes(file))).toEqual([]);
  });
});
