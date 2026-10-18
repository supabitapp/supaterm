// @effect-diagnostics nodeBuiltinImport:off - compiles the real source file on disk.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { transform } from "oxc-transform-react";
import { expect, it } from "vite-plus/test";

const sidebarPath = NodeURL.fileURLToPath(new URL("./Sidebar.tsx", import.meta.url));

// The compiler drops a cache scope without any diagnostic when the scope spans a
// hook call, so the coverage test passes while these values are rebuilt on every
// thread shell event. Each one feeds DndContext, the sensors, the sortable rows,
// the list ref or the motion effect, which all redo work when its identity changes.
const IDENTITY_SENSITIVE_VALUES = [
  "attachListMotionRef",
  "dndModifiers",
  "pointerSensorOptions",
  "dndCollisionDetection",
  "sidebarSortingStrategy",
  "handleThreadDragStart",
  "handleThreadDragOver",
  "handleThreadDragEnd",
  "cancelThreadDrag",
  "listMotionPass",
];

it("caches the values the sidebar's drag and drop and list motion depend on", async () => {
  const { code } = await transform(sidebarPath, NodeFS.readFileSync(sidebarPath, "utf8"), {
    jsx: { runtime: "automatic", development: false, refresh: false },
    reactCompiler: true,
  });
  const sidebar = code.slice(code.indexOf("export default function Sidebar("));
  const rebuiltEveryRender = IDENTITY_SENSITIVE_VALUES.filter(
    (name) => !new RegExp(String.raw`\bconst ${name} = t\d+;`).test(sidebar),
  );
  expect(rebuiltEveryRender).toEqual([]);
});
