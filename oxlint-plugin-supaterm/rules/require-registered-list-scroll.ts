import { defineRule } from "@oxlint/plugins";

const SCROLL_COMPONENT_PROP: Readonly<Record<string, string>> = {
  LegendList: "renderScrollComponent",
  AnimatedLegendList: "renderScrollComponent",
  KeyboardAwareLegendList: "ScrollViewComponent",
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require mobile lists to render through a header-registered scroll view (renderScrollComponent).",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const prop = SCROLL_COMPONENT_PROP[node.name.name];
        if (!prop) return;
        const registered = node.attributes.some(
          (attribute) =>
            attribute.type === "JSXAttribute" &&
            attribute.name.type === "JSXIdentifier" &&
            attribute.name.name === prop,
        );
        if (registered) return;
        context.report({
          node,
          message: `Pass ${prop} so the list scrolls in a header-registered scroll view: NativeScrollView on iOS, or a component wrapping NativeScrollViewMarker. A list nested in another scroll surface or sheet can suppress this with a reason.`,
        });
      },
    };
  },
});
