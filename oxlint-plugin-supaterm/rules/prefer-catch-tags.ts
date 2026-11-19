import { defineRule } from "@oxlint/plugins";

import { isEffectNamespace } from "../effect-bindings.ts";

const MESSAGE = "Catch known tags with `Effect.catchTags({ Tag: handler })`, even for one tag.";

export default defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Require `Effect.catchTags` over `Effect.catchTag`.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "effect/Effect") return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            (specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : specifier.imported.value) === "catchTag"
          ) {
            context.report({ node: specifier, message: MESSAGE });
          }
        }
      },
      MemberExpression(node) {
        if (
          !node.computed &&
          node.object.type === "Identifier" &&
          node.property.type === "Identifier" &&
          node.property.name === "catchTag" &&
          isEffectNamespace(context, node.object)
        ) {
          context.report({ node, message: MESSAGE });
        }
      },
    };
  },
});
