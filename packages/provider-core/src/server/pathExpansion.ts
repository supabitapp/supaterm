// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

export function expandHomePath(value: string, home: string): string;
export function expandHomePath(value: string, home: string) {
  if (!value) return value satisfies string;
  if (value === "~") return home satisfies string;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return NodePath.join(home, value.slice(2)) satisfies string;
  }
  return value satisfies string;
}

const HOME_PATH_VARIABLES = new Set(["CODEX_HOME", "CLAUDE_CONFIG_DIR", "GROK_HOME"]);

export function expandHomeVariable(name: string, value: string, home: string): string;
export function expandHomeVariable(name: string, value: string, home: string) {
  return (HOME_PATH_VARIABLES.has(name) ? expandHomePath(value, home) : value) satisfies string;
}
