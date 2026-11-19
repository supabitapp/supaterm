import { defineRule, type ESTree } from "@oxlint/plugins";

const EQUALITY_OPERATORS = new Set(["==", "===", "!=", "!=="]);
const BROAD_CATCH_METHODS = new Set(["catch", "catchAll", "catchIf"]);

const isNamed = (computed: boolean, property: ESTree.Node, name: string) =>
  computed
    ? property.type === "Literal" && property.value === name
    : property.type === "Identifier" && property.name === name;

const isTagMember = (node: ESTree.Node | null | undefined): node is ESTree.MemberExpression =>
  node?.type === "MemberExpression" && isNamed(node.computed, node.property, "_tag");

const isReasonTagMember = (node: ESTree.MemberExpression) =>
  node.object.type === "MemberExpression" &&
  isNamed(node.object.computed, node.object.property, "reason");

const isStringLiteral = (node: ESTree.Node) =>
  node.type === "Literal" && typeof node.value === "string";

const tagMemberFromComparison = (node: ESTree.BinaryExpression) => {
  if (!EQUALITY_OPERATORS.has(node.operator)) return undefined;
  if (isTagMember(node.left) && isStringLiteral(node.right)) return node.left;
  if (isTagMember(node.right) && isStringLiteral(node.left)) return node.right;
  return undefined;
};

const isBroadEffectCatchCall = (
  node: ESTree.Node | null | undefined,
): node is ESTree.CallExpression =>
  node?.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  node.callee.object.type === "Identifier" &&
  node.callee.object.name === "Effect" &&
  !node.callee.computed &&
  node.callee.property.type === "Identifier" &&
  BROAD_CATCH_METHODS.has(node.callee.property.name);

const isInsideBroadEffectHandler = (node: ESTree.Node) => {
  let current = node.parent;
  while (current !== null && current !== undefined) {
    if (current.type === "ArrowFunctionExpression" || current.type === "FunctionExpression") {
      const call = current.parent;
      return isBroadEffectCatchCall(call) && call.arguments.includes(current);
    }
    current = current.parent;
  }
  return false;
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
    const report = (node: ESTree.Node, member: ESTree.MemberExpression) => {
      if (!isInsideBroadEffectHandler(node)) return;
      context.report({ node, messageId: isReasonTagMember(member) ? "reason" : "tag" });
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
