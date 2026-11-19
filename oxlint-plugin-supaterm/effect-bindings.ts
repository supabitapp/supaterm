import type { Context, ESTree, Variable } from "@oxlint/plugins";

export function resolveVariable(
  context: Context,
  identifier: ESTree.Node & { readonly name: string },
): Variable | undefined {
  let scope = context.sourceCode.getScope(identifier);
  while (true) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    if (scope.upper === null) return undefined;
    scope = scope.upper;
  }
}

export function isEffectNamespace(context: Context, identifier: ESTree.IdentifierReference) {
  return (
    resolveVariable(context, identifier)?.defs.some(
      (def) =>
        def.type === "ImportBinding" &&
        def.node.type === "ImportNamespaceSpecifier" &&
        def.parent?.type === "ImportDeclaration" &&
        def.parent.source.value === "effect/Effect",
    ) ?? false
  );
}
