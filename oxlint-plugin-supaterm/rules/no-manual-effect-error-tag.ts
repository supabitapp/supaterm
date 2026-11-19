import { defineRule, type ESTree } from "@oxlint/plugins";

import { isEffectNamespace, resolveVariable } from "../effect-bindings.ts";

const EQUALITY_OPERATORS = new Set(["==", "===", "!=", "!=="]);
const BROAD_CATCH_METHODS = new Set(["catch", "catchAll", "catchIf"]);

const isNamed = (computed: boolean, property: ESTree.Node, name: string) =>
  computed
    ? property.type === "Literal" && property.value === name
    : property.type === "Identifier" && property.name === name;

const isTagMember = (node: ESTree.Node | null | undefined): node is ESTree.MemberExpression =>
  node?.type === "MemberExpression" && isNamed(node.computed, node.property, "_tag");

const reasonOwner = (node: ESTree.MemberExpression) =>
  node.object.type === "MemberExpression" &&
  isNamed(node.object.computed, node.object.property, "reason")
    ? node.object.object
    : undefined;

const isStringLiteral = (node: ESTree.Node) =>
  node.type === "Literal" && typeof node.value === "string";

const tagMemberFromComparison = (node: ESTree.BinaryExpression) => {
  if (!EQUALITY_OPERATORS.has(node.operator)) return undefined;
  if (isTagMember(node.left) && isStringLiteral(node.right)) return node.left;
  if (isTagMember(node.right) && isStringLiteral(node.left)) return node.right;
  return undefined;
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Use Effect tagged error handlers instead of branching on `_tag` in a broad catch handler.",
    },
    messages: {
      tag: "Use `Effect.catchTags` instead of discriminating a tagged error in a broad Effect catch handler.",
      reason:
        "Use `Effect.catchReasons` instead of discriminating a tagged `reason` in a broad Effect catch handler.",
    },
  },
  create(context) {
    const isBroadEffectCatchCall = (node: ESTree.Node | null): node is ESTree.CallExpression =>
      node?.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      !node.callee.computed &&
      node.callee.object.type === "Identifier" &&
      node.callee.property.type === "Identifier" &&
      BROAD_CATCH_METHODS.has(node.callee.property.name) &&
      isEffectNamespace(context, node.callee.object);

    const isCaughtError = (node: ESTree.Node) => {
      if (node.type !== "Identifier") return false;
      return (
        resolveVariable(context, node)?.defs.some((def) => {
          if (def.type !== "Parameter") return false;
          const handler = def.node;
          return (
            (handler.type === "ArrowFunctionExpression" || handler.type === "FunctionExpression") &&
            handler.params[0] === def.name &&
            isBroadEffectCatchCall(handler.parent) &&
            handler.parent.arguments.includes(handler)
          );
        }) ?? false
      );
    };

    const report = (node: ESTree.Node, member: ESTree.MemberExpression) => {
      const owner = reasonOwner(member);
      if (isCaughtError(owner ?? member.object)) {
        context.report({ node, messageId: owner === undefined ? "tag" : "reason" });
      }
    };

    return {
      BinaryExpression(node) {
        const member = tagMemberFromComparison(node);
        if (member !== undefined) report(node, member);
      },
      SwitchStatement(node) {
        if (isTagMember(node.discriminant)) report(node, node.discriminant);
      },
    };
  },
});
