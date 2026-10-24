import { defineRule } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { getPropertyName, unwrapExpression } from "../utils.ts";

const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
// Opt-in suites that drive real provider agents through whole turns; minutes are the
// expected cost there, not a hidden wait.
const LIVE_TEST_FILE_PATTERN = /\.live\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const TEST_FUNCTIONS = new Set(["describe", "it", "suite", "test"]);
const HOOK_FUNCTIONS = new Set(["afterAll", "afterEach", "beforeAll", "beforeEach"]);
const TIMEOUT_OPTIONS = new Set(["retry", "timeout"]);
const SET_CONFIG_OPTIONS = new Set(["hookTimeout", "retry", "testTimeout"]);

const TIMEOUT_MESSAGE =
  "Per-test timeouts and retries hide waits that should be event-driven; the project timeout is the ceiling. Remove the override and await the milestone.";

// Walks `it.effect.each(cases)` / `describe.skipIf(x)` / `it.layer(L)` down to the
// identifier that registers the test.
const chainRoot = (node: unknown): Option.Option<string> => {
  const expression = unwrapExpression(node);
  if (Option.isNone(expression)) return Option.none();
  const value = expression.value;
  if (value.type === "Identifier") return Option.some(value.name);
  if (value.type === "MemberExpression") return chainRoot(value.object);
  if (value.type === "CallExpression") return chainRoot(value.callee);
  return Option.none();
};

const isTestChain = (node: unknown) =>
  Option.exists(chainRoot(node), (name) => TEST_FUNCTIONS.has(name));

const hasOption = (node: unknown, names: ReadonlySet<string>) => {
  const expression = unwrapExpression(node);
  if (Option.isNone(expression) || expression.value.type !== "ObjectExpression") return false;
  return expression.value.properties.some(
    (property) =>
      property.type === "Property" &&
      Option.exists(getPropertyName(property.key), (name) => names.has(name)),
  );
};

const isNumericLiteral = (node: unknown) =>
  Option.exists(
    unwrapExpression(node),
    (expression) => expression.type === "Literal" && typeof expression.value === "number",
  );

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow per-test timeouts and retries.",
    },
  },
  create(context) {
    if (!TEST_FILE_PATTERN.test(context.filename)) return {};
    if (LIVE_TEST_FILE_PATTERN.test(context.filename)) return {};

    return {
      CallExpression(node) {
        const callee = unwrapExpression(node.callee);
        if (Option.isNone(callee)) return;

        if (
          callee.value.type === "MemberExpression" &&
          Option.exists(chainRoot(callee.value.object), (name) => name === "vi") &&
          Option.exists(getPropertyName(callee.value.property), (name) => name === "setConfig")
        ) {
          if (hasOption(node.arguments[0], SET_CONFIG_OPTIONS)) {
            context.report({ node, message: TIMEOUT_MESSAGE });
          }
          return;
        }

        if (callee.value.type === "Identifier" && HOOK_FUNCTIONS.has(callee.value.name)) {
          if (isNumericLiteral(node.arguments[1])) {
            context.report({ node, message: TIMEOUT_MESSAGE });
          }
          return;
        }

        if (!isTestChain(callee.value)) return;
        const [, second, third] = node.arguments;
        // `test(name, { timeout }, fn)` is the options-first spelling of the same override.
        if (
          isNumericLiteral(third) ||
          hasOption(third, TIMEOUT_OPTIONS) ||
          hasOption(second, TIMEOUT_OPTIONS)
        ) {
          context.report({ node, message: TIMEOUT_MESSAGE });
        }
      },
    };
  },
});
