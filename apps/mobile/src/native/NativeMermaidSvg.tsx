import { diagramInstanceSvg, type Diagram } from "@supaterm/mermaid/diagram";
import { useId, useMemo, type ReactNode } from "react";
import { parse, SvgAst } from "react-native-svg";

import { nativeDiagramStyles } from "../lib/mermaidSvg";
import { themeColorToNativeColor } from "../lib/mobileTheme";
import { useUniwindTheme } from "../lib/useUniwindTheme";

export function NativeMermaidSvg({
  diagram,
  zoom = 1,
  fallback,
}: {
  readonly diagram: Diagram;
  readonly zoom?: number;
  readonly fallback: ReactNode;
}) {
  const theme = useUniwindTheme();
  const id = useId();
  const ast = useMemo(() => {
    const color = (name: keyof typeof theme) => themeColorToNativeColor(theme[name]);
    try {
      return parse(diagramInstanceSvg(diagram, id), (root) =>
        nativeDiagramStyles(root, {
          "--pele-bg": color("--color-md-code-bg"),
          "--pele-fg": color("--color-foreground"),
          "--pele-muted": color("--color-foreground-muted"),
          "--pele-line": color("--color-foreground-secondary"),
          "--pele-surface": color("--color-card"),
          "--pele-surface-alt": color("--color-card-alt"),
          "--pele-border": color("--color-border"),
          "--pele-accent": color("--color-primary"),
          "--pele-critical": color("--color-danger"),
        }),
      );
    } catch {
      return null;
    }
  }, [diagram, id, theme]);
  return ast ? (
    <SvgAst
      ast={ast}
      override={{
        width: diagram.width * zoom,
        height: diagram.height * zoom,
        accessible: true,
        accessibilityLabel: `${diagram.type} diagram`,
      }}
    />
  ) : (
    fallback
  );
}
