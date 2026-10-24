import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { transformSync, type PluginObj, type NodePath as BabelNodePath } from "@babel/core";
import { DIAGRAM_LIMITS } from "@supaterm/mermaid/diagram";
import { build } from "vite-plus";

const mobileRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

export async function generateMermaidWorklet(
  outputRoot = NodePath.join(mobileRoot, ".generated/mermaid-worklet"),
) {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    define: { URL: "globalThis.URL" },
    build: {
      write: false,
      target: "es2022",
      minify: true,
      lib: {
        entry: NodeURL.fileURLToPath(import.meta.resolve("@supaterm/mermaid")),
        name: "SupatermMermaid",
        formats: ["iife"],
      },
    },
  });
  const bundles = Array.isArray(result) ? result : [result];
  const chunks = bundles.flatMap((bundle) =>
    "output" in bundle ? bundle.output.filter((output) => output.type === "chunk") : [],
  );
  const chunk = chunks[0];
  if (!chunk || chunks.length !== 1 || chunk.imports.length || chunk.dynamicImports.length) {
    throw new Error("Mermaid worklet build must emit one self-contained script.");
  }
  const instrumented = transformSync(chunk.code, {
    configFile: false,
    babelrc: false,
    compact: true,
    plugins: [
      ({ types: t }): PluginObj => ({
        visitor: {
          TaggedTemplateExpression(path) {
            const { tag, quasi } = path.node;
            if (tag.type !== "MemberExpression")
              throw new Error("Unsupported diagram template tag");
            if (
              !t.isIdentifier(tag.object, { name: "String" }) ||
              !t.isIdentifier(tag.property, { name: "raw" })
            ) {
              throw new Error("Unsupported tagged template in diagram runtime");
            }
            const first = quasi.quasis[0];
            if (!first) throw new Error("Missing diagram template literal");
            const value = t.expressionStatement(t.stringLiteral(first.value.raw));
            quasi.expressions.forEach((expression, index) => {
              if (!t.isExpression(expression))
                throw new Error("Unexpected diagram template expression");
              value.expression = t.binaryExpression(
                "+",
                t.binaryExpression("+", value.expression, expression),
                t.stringLiteral(quasi.quasis[index + 1]!.value.raw),
              );
            });
            path.replaceWith(value.expression);
          },
          "Function|Loop"(path: BabelNodePath) {
            if (!path.isFunction() && !path.isLoop()) return;
            const body = path.get("body");
            if (Array.isArray(body)) throw new Error("Unexpected renderer body");
            if (!body.isBlockStatement()) {
              body.replaceWith(
                t.blockStatement([body.isExpression() ? t.returnStatement(body.node) : body.node]),
              );
            }
            if (body.isBlockStatement()) {
              body.unshiftContainer(
                "body",
                t.expressionStatement(t.callExpression(t.identifier("__checkDiagramBudget"), [])),
              );
            }
          },
        },
      }),
    ],
  })?.code;
  if (!instrumented) throw new Error("Mermaid worklet instrumentation failed.");
  const code = `module.exports = function renderMermaidWorklet(source, options) {
"worklet";
if (!globalThis.__supatermMermaid) {
  let deadline = Infinity;
  let steps = 0;
  function __checkDiagramBudget() {
    if (++steps % 128 === 0 && Date.now() > deadline) {
      throw new Error("Diagram rendering budget exceeded");
    }
  }
  ${instrumented}
  globalThis.__supatermMermaid = function(source, options) {
    steps = 0;
    deadline = Date.now() + ${DIAGRAM_LIMITS.durationMs};
    try {
      const result = SupatermMermaid.renderDiagram(source, options);
      return Date.now() > deadline ? null : result;
    } catch {
      return null;
    }
  };
}
return globalThis.__supatermMermaid(source, options);
};
`;
  await NodeFSP.mkdir(outputRoot, { recursive: true });
  for (const [name, contents] of [
    ["index.js", code],
    ["package.json", '{"main":"index.js"}\n'],
  ] as const) {
    const destination = NodePath.join(outputRoot, name);
    const previous = await NodeFSP.readFile(destination, "utf8").catch(() => null);
    if (previous !== contents) await NodeFSP.writeFile(destination, contents);
  }
}
