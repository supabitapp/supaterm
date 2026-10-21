import { describe, expect, it, vi } from "vite-plus/test";
import { closestCenter, type CollisionDetection } from "@dnd-kit/core";
import { verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";
import {
  createSidebarCollisionDetection,
  createSidebarSortingStrategy as createSortingStrategy,
  restrictBelowSidebarLabel,
} from "./Sidebar.drag";
import {
  resolveSidebarDropTarget,
  sidebarListItemId,
  sidebarMarkerId,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "./Sidebar.logic";

const thread = (key: string, section: SidebarSection): SidebarListItem => ({
  kind: "thread",
  key,
  section,
});
const marker = (marker: SidebarListMarker): SidebarListItem => ({ kind: "marker", marker });
const pinnedHeader = marker("pinned-header");
const divider = marker("pinned-divider");
const doneHeader = marker("done-header");
const stationary = { x: 0, y: 0, scaleX: 1, scaleY: 1 };

function layout(
  items: readonly SidebarListItem[],
  active: string,
  over: string,
  scale = 1,
  cardHeight = 48,
) {
  let top = 100;
  const rects = items.map((item) => {
    const height =
      item.kind === "thread"
        ? (item.section === "pinned" || item.section === "active" || item.section === "working"
            ? cardHeight
            : 36) * scale
        : item.kind === "group"
          ? 32 * scale
          : item.marker === "pinned-header" || item.marker === "pinned-divider"
            ? 0
            : (item.marker.endsWith("placeholder") ? 0 : 32) * scale;
    const rect = { top, height, bottom: top + height, left: 0, right: 260, width: 260 };
    top += height + 1;
    return rect;
  });
  const activeIndex = items.findIndex((item) => sidebarListItemId(item) === active);
  return {
    activeIndex,
    overIndex: items.findIndex((item) => sidebarListItemId(item) === over),
    activeNodeRect: rects[activeIndex]!,
    rects,
    index: 0,
  } satisfies Parameters<SortingStrategy>[0];
}

type PreviewInput = Omit<Parameters<typeof createSortingStrategy>[0], "inbox"> & {
  readonly inbox?: Parameters<typeof createSortingStrategy>[0]["inbox"];
  readonly activeOrder?: readonly string[];
};

function createSidebarSortingStrategy(input: PreviewInput): SortingStrategy {
  let previous: { activeIndex: number; overIndex: number; strategy: SortingStrategy } | undefined;
  return (args) => {
    if (previous?.activeIndex !== args.activeIndex || previous.overIndex !== args.overIndex) {
      const active = input.items[args.activeIndex];
      const over = input.items[args.overIndex];
      const target =
        active?.kind === "thread" && over
          ? resolveSidebarDropTarget(input.items, active.key, sidebarListItemId(over))
          : null;
      const other = input.items.filter(
        (item) =>
          (item.kind === "thread" &&
            (item.section === "active" || item.section === "working") &&
            item !== active) ||
          (item.kind === "marker" && item.marker === "working-header"),
      );
      const activeOrder = input.activeOrder ?? target?.activeOrder ?? [];
      const returning = activeOrder.map((key) => thread(key, "active"));
      const working = other.filter(
        (item) => item.kind === "marker" || (item.kind === "thread" && item.section === "working"),
      );
      previous = {
        activeIndex: args.activeIndex,
        overIndex: args.overIndex,
        strategy: createSortingStrategy({
          ...input,
          inbox: input.inbox ?? { active: [...returning, ...working], other },
        }),
      };
    }
    return previous.strategy(args);
  };
}

function preview(
  input: Parameters<typeof createSidebarSortingStrategy>[0],
  active: string,
  over: string,
  scale = 1,
) {
  const strategy = createSidebarSortingStrategy(input);
  const args = layout(input.items, active, over, scale);
  return new Map(
    input.items.map((item, index) => [sidebarListItemId(item), strategy({ ...args, index })]),
  );
}

describe("sidebar collision detection", () => {
  function collisionArgs(blockedAboveSource = false) {
    const rows = [thread("source", "active"), thread("blocked", "active")];
    const items = [
      pinnedHeader,
      divider,
      ...(blockedAboveSource ? rows.toReversed() : rows),
      doneHeader,
      marker("done-placeholder"),
    ];
    const { rects, activeIndex, overIndex } = layout(items, "source", "blocked");
    const collisionRect = rects[overIndex]!;
    return {
      active: {
        id: "source",
        data: { current: {} },
        rect: { current: { initial: rects[activeIndex]!, translated: collisionRect } },
      },
      collisionRect,
      droppableRects: new Map(items.map((item, index) => [sidebarListItemId(item), rects[index]!])),
      droppableContainers: items.map((item, index) => ({
        id: sidebarListItemId(item),
        key: sidebarListItemId(item),
        disabled: false,
        data: { current: {} },
        node: { current: null },
        rect: { current: rects[index]! },
      })),
      pointerCoordinates: null,
    } satisfies Parameters<CollisionDetection>[0];
  }

  it.each([
    [false, sidebarMarkerId("done-header")],
    [true, sidebarMarkerId("pinned-divider")],
  ] as const)(
    "rejects unsupported Active instead of selecting %s / %s",
    (blockedAboveSource, nearbyTarget) => {
      const args = collisionArgs(blockedAboveSource);
      const detector = createSidebarCollisionDetection((id) => id !== "blocked");
      const filtered = closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (container) => container.id !== "blocked",
        ),
      });
      expect(filtered[0]?.id).toBe(nearbyTarget);
      expect(detector(args).map((collision) => collision.id)).toEqual(["source"]);
    },
  );

  it("selects the nearest supported target", () => {
    const detector = createSidebarCollisionDetection(() => true);
    expect(detector(collisionArgs())[0]?.id).toBe("blocked");
  });

  it.each([
    { sourceSection: "active", pins: 0 },
    { sourceSection: "active", pins: 1 },
    { sourceSection: "pinned", pins: 1 },
    { sourceSection: "done", pins: 1 },
  ] as const)(
    "switches on crossing the divider row from $sourceSection with $pins pins",
    ({ sourceSection, pins }) => {
      const items = [
        pinnedHeader,
        ...(pins ? [thread("p", "pinned")] : []),
        ...(sourceSection === "pinned" ? [thread("source", "pinned")] : []),
        divider,
        thread("a", "active"),
        ...(sourceSection === "active" ? [thread("source", "active")] : []),
        doneHeader,
        ...(sourceSection === "done" ? [thread("source", "done")] : []),
      ];
      const { rects, activeIndex } = layout(items, "source", "a");
      const sourceRect = rects[activeIndex]!;
      let boundaryTop = 300;
      const boundaryNode = {
        querySelector: () => ({
          getBoundingClientRect: () => ({
            top: boundaryTop,
            bottom: boundaryTop + 16,
            left: 0,
            right: 260,
          }),
        }),
      } as unknown as HTMLElement;
      const detector = createSidebarCollisionDetection(() => true, {
        items,
        activationY: sourceSection === "pinned" ? 200 : 600,
      });
      const at = (center: number) => {
        const collisionRect = {
          ...sourceRect,
          top: center - sourceRect.height / 2,
          bottom: center + sourceRect.height / 2,
        };
        const args = {
          ...collisionArgs(),
          active: {
            id: "source",
            data: { current: {} },
            rect: { current: { initial: sourceRect, translated: collisionRect } },
          },
          collisionRect,
          pointerCoordinates: { x: 130, y: center },
          droppableRects: new Map(
            items.map((item, index) => [sidebarListItemId(item), rects[index]!]),
          ),
          droppableContainers: items.map((item, index) => ({
            id: sidebarListItemId(item),
            key: sidebarListItemId(item),
            disabled: false,
            data: { current: {} },
            node: {
              current:
                item === divider
                  ? boundaryNode
                  : item === doneHeader
                    ? ({ getBoundingClientRect: () => ({ top: 600 }) } as unknown as HTMLElement)
                    : null,
            },
            rect: { current: rects[index]! },
          })),
        };
        const over = detector(args)[0];
        return over ? resolveSidebarDropTarget(items, "source", String(over.id))?.section : null;
      };
      expect(at(330)).toBe("active");
      expect(at(317)).toBe("active");
      expect(at(316)).toBe("pinned");
      boundaryTop = 400;
      expect(at(316)).toBe("pinned");
      expect(at(399)).toBe("pinned");
      expect(at(400)).toBe("active");
      boundaryTop = 300;
      expect(at(400)).toBe("active");
      expect(at(317)).toBe("active");
      expect(at(316)).toBe("pinned");
    },
  );

  it("returns no collision if an unsupported target has no source fallback", () => {
    const args = collisionArgs();
    const detector = createSidebarCollisionDetection(() => false);
    expect(
      detector({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (container) => container.id !== "source",
        ),
      }),
    ).toEqual([]);
  });

  it("validates each hovered target once and always allows returning to the source", () => {
    const args = collisionArgs();
    const isValid = vi.fn((id: string) => id !== "blocked");
    const detector = createSidebarCollisionDetection(isValid);
    expect(detector(args)[0]?.id).toBe("source");
    expect(
      detector({
        ...args,
        collisionRect: {
          ...args.collisionRect,
          top: args.collisionRect.top + 3,
          bottom: args.collisionRect.bottom + 3,
        },
      })[0]?.id,
    ).toBe("source");
    expect(detector({ ...args, collisionRect: args.droppableRects.get("source")! })[0]?.id).toBe(
      "source",
    );
    expect(
      detector({
        ...args,
        collisionRect: args.droppableRects.get(sidebarMarkerId("done-placeholder"))!,
      })[0]?.id,
    ).toBe(sidebarMarkerId("done-placeholder"));
    expect(isValid.mock.calls).toEqual([["blocked"], [sidebarMarkerId("done-placeholder")]]);
  });
});

describe("sidebar drag projection", () => {
  it("reserves no draft space when the mounted draft block has no rows", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      marker("drafts-block"),
      divider,
      thread("a", "active"),
      doneHeader,
      thread("s", "done"),
    ];
    const args = layout(items, "p", sidebarMarkerId("pinned-divider"));
    const draftsHeight = args.rects[2]!.height + 1;
    args.rects[2]!.height = 0;
    args.rects[2]!.bottom = args.rects[2]!.top;
    for (const rect of args.rects.slice(3)) {
      rect.top -= draftsHeight;
      rect.bottom -= draftsHeight;
    }
    const strategy = createSidebarSortingStrategy({
      items,
      doneOrder: ["s"],
      doneExpanded: true,
    });
    expect(strategy({ ...args, index: 3 })).toEqual({ ...stationary, y: -49 });
    expect(strategy({ ...args, index: 4 })).toEqual(stationary);
    expect(strategy({ ...args, index: 5 })).toEqual(stationary);
  });

  it("preserves draft space between pinned and active while a pin moves to active", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      marker("drafts-block"),
      divider,
      thread("a", "active"),
      doneHeader,
      thread("s", "done"),
    ];
    const args = layout(items, "p", sidebarMarkerId("pinned-divider"));
    args.rects[2]!.height += 100;
    args.rects[2]!.bottom += 100;
    for (const rect of args.rects.slice(3)) {
      rect.top += 100;
      rect.bottom += 100;
    }
    const strategy = createSidebarSortingStrategy({
      items,
      doneOrder: ["s"],
      doneExpanded: true,
    });
    expect(strategy({ ...args, index: 2 })).toEqual({ ...stationary, y: -49 });
    expect(strategy({ ...args, index: 3 })).toEqual({ ...stationary, y: -49 });
    expect(strategy({ ...args, index: 4 })).toEqual(stationary);
    expect(strategy({ ...args, index: 5 })).toEqual(stationary);
  });

  it.each([
    ["a2", "a1"],
    ["p", "a1"],
    ["s", sidebarMarkerId("pinned-header")],
    ["z", sidebarMarkerId("done-header")],
  ])("restores every row and marker when dragging %s out after hovering %s", (active, over) => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      marker("active-placeholder"),
      thread("a1", "active"),
      thread("a2", "active"),
      marker("snoozed-header"),
      thread("z", "snoozed"),
      doneHeader,
      marker("done-placeholder"),
      thread("s", "done"),
    ];
    const input = {
      items,
      doneOrder: ["z", "s"],
      doneExpanded: true,
      boundaryLabelHeight: 24,
      snoozedThreadCount: 1,
    };
    const reordered = preview(input, active, over);
    expect([...reordered.values()].some((transform) => transform?.y !== 0)).toBe(true);

    const restored = preview({ ...input, enabled: false }, active, over);
    for (const transform of restored.values()) expect(transform).toEqual(stationary);

    expect(preview({ ...input, enabled: true }, active, over)).toEqual(reordered);
  });

  it.each([
    ["a1", "a2"],
    ["a1", sidebarMarkerId("done-header")],
    ["z", "a2"],
  ])("keeps sparse shelves at the bottom when dragging %s over %s", (active, over) => {
    const items = [
      pinnedHeader,
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      marker("snoozed-header"),
      thread("z", "snoozed"),
      doneHeader,
      thread("s", "done"),
    ];
    const strategy = createSidebarSortingStrategy({
      items,
      doneOrder: over === sidebarMarkerId("done-header") ? ["a1", "s"] : ["s"],
      doneExpanded: true,
      boundaryLabelHeight: 24,
      snoozedThreadCount: 1,
    });
    const args = layout(items, active, over);
    for (const rect of args.rects.slice(4)) {
      rect.top += 400;
      rect.bottom += 400;
    }
    const lastIndex = items.length - 1;
    expect(strategy({ ...args, index: lastIndex })).toEqual(stationary);
  });

  const pinned = [
    pinnedHeader,
    thread("p1", "pinned"),
    thread("p2", "pinned"),
    divider,
    thread("a1", "active"),
    doneHeader,
    thread("s1", "done"),
  ];

  it.each([
    ["p1", "p2"],
    ["p2", "p1"],
  ])("preserves existing pinned transforms from %s to %s", (active, over) => {
    const strategy = createSidebarSortingStrategy({
      items: pinned,
      doneOrder: [],
      doneExpanded: true,
    });
    const args = layout(pinned, active, over);
    for (let index = 0; index < pinned.length; index += 1) {
      if (index === args.activeIndex) continue;
      expect(strategy({ ...args, index })).toEqual(verticalListSortingStrategy({ ...args, index }));
    }
  });

  it("keeps the pinned header above the gap when a lower pin moves to the top", () => {
    const result = preview(
      { items: pinned, doneOrder: [], doneExpanded: true },
      "p2",
      sidebarMarkerId("pinned-header"),
    );
    expect(result.get(sidebarMarkerId("pinned-header"))).toEqual(stationary);
    expect(result.get("p1")).toEqual({ ...stationary, y: 49 });
    expect(result.get(sidebarMarkerId("pinned-divider"))).toEqual(stationary);
    expect(result.get("a1")).toEqual(stationary);
  });

  it.each([
    ["a1", "a2"],
    ["a2", "a1"],
  ])("uses pinned dragging behavior for Active from %s to %s", (active, over) => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      doneHeader,
      thread("s", "done"),
    ];
    const strategy = createSidebarSortingStrategy({
      items,
      doneOrder: [],
      doneExpanded: true,
    });
    const args = layout(items, active, over);
    for (let index = 0; index < items.length; index += 1) {
      if (index === args.activeIndex) continue;
      expect(strategy({ ...args, index })).toEqual(verticalListSortingStrategy({ ...args, index }));
    }
  });

  it("preserves done order while opening the zero-height Active target", () => {
    const items = [
      pinnedHeader,
      divider,
      marker("active-placeholder"),
      doneHeader,
      thread("first", "done"),
      thread("second", "done"),
    ];
    const result = preview(
      { items, doneOrder: ["first", "second"], doneExpanded: true },
      "second",
      "first",
    );
    expect(result.get(sidebarMarkerId("active-placeholder"))).toEqual(stationary);
    expect(result.get(sidebarMarkerId("done-header"))).toEqual({ ...stationary, y: 36 });
    expect(result.get("first")).toEqual({ ...stationary, y: 36 });
    expect(result.get("second")).toEqual(stationary);
  });

  it.each([
    [sidebarMarkerId("pinned-divider"), 0, 0],
    ["a1", -49, 0],
    ["a2", -49, -49],
  ] as const)(
    "opens the active pointer slot over %s without adding an empty pinned row",
    (over, a1Offset, a2Offset) => {
      const items = [
        pinnedHeader,
        thread("p", "pinned"),
        divider,
        thread("a1", "active"),
        thread("a2", "active"),
        doneHeader,
        thread("s", "done"),
      ];
      const result = preview({ items, doneOrder: [], doneExpanded: true }, "p", over);
      expect(result.get(sidebarMarkerId("pinned-header"))).toEqual(stationary);
      expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(-49);
      expect(result.get("a1")?.y).toBe(a1Offset);
      expect(result.get("a2")?.y).toBe(a2Offset);
      expect(result.get(sidebarMarkerId("done-header"))?.y).toBe(0);
    },
  );

  it("opens label space below each pinned boundary while dragging", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      doneHeader,
      thread("s", "done"),
    ];
    const result = preview(
      { items, doneOrder: [], doneExpanded: true, boundaryLabelHeight: 16 },
      "a2",
      "a1",
    );
    expect(result.get(sidebarMarkerId("pinned-header"))).toEqual(stationary);
    expect(result.get("p")?.y).toBe(16);
    expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(16);
    expect(result.get("a2")).toEqual(stationary);
    expect(result.get("a1")?.y).toBe(32 + 49);
    expect(result.get(sidebarMarkerId("done-header"))?.y).toBe(32);
    expect(result.get("s")?.y).toBe(32);
  });

  it.each(["s1", "missing-target"])("keeps label clearance when a done drag is over %s", (over) => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      doneHeader,
      thread("s1", "done"),
      thread("s2", "done"),
    ];
    const result = preview(
      {
        items,
        doneOrder: ["s1", "s2"],
        doneExpanded: true,
        boundaryLabelHeight: 24,
      },
      "s2",
      over,
    );
    expect(result.get("p")?.y).toBe(24);
    expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(24);
    expect(result.get("a")?.y).toBe(48);
    expect(result.get("s1")?.y).toBe(48);
    expect(result.get("s2")).toEqual(stationary);
  });

  it("keeps permanent Pinned and Active headers at their measured height", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      doneHeader,
    ];
    const args = layout(items, "a2", "a1");
    for (const index of [0, 2]) {
      args.rects[index]!.height = 32;
      args.rects[index]!.bottom += 32;
      for (const rect of args.rects.slice(index + 1)) {
        rect.top += 32;
        rect.bottom += 32;
      }
    }
    const strategy = createSidebarSortingStrategy({
      items,
      doneOrder: [],
      doneExpanded: false,
      boundaryLabelHeight: 24,
    });
    for (const index of [0, 1, 2, 5]) {
      expect(strategy({ ...args, index })).toEqual(stationary);
    }
    expect(strategy({ ...args, index: 3 })?.y).toBe(49);
  });

  it("stacks the labels with their gaps when the pinned section is empty", () => {
    const items = [
      pinnedHeader,
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      doneHeader,
      thread("s", "done"),
    ];
    const result = preview(
      { items, doneOrder: [], doneExpanded: true, boundaryLabelHeight: 16 },
      "a2",
      "a1",
    );
    expect(result.get(sidebarMarkerId("pinned-header"))).toEqual(stationary);
    expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(16);
    expect(result.get("a1")?.y).toBe(32 + 49);
    expect(result.get(sidebarMarkerId("done-header"))?.y).toBe(32);
  });

  it("scales the label space with the measured root scale", () => {
    const items = [pinnedHeader, thread("p", "pinned"), divider, thread("a1", "active")];
    const result = preview(
      { items, doneOrder: [], doneExpanded: true, boundaryLabelHeight: 16 },
      "a1",
      "p",
      2,
    );
    expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(32 + 97);
  });

  it("keeps the pinned header above the first arriving pin", () => {
    const items = [
      pinnedHeader,
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      doneHeader,
      thread("s", "done"),
    ];
    const result = preview(
      { items, doneOrder: [], doneExpanded: true },
      "a2",
      sidebarMarkerId("pinned-header"),
    );
    expect(result.get(sidebarMarkerId("pinned-header"))).toEqual(stationary);
    expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(49);
    expect(result.get("a1")?.y).toBe(49);
    expect(result.get(sidebarMarkerId("done-header"))?.y).toBe(0);
  });

  it.each([
    ["p", -49, -1],
    ["s", 0, 48],
  ] as const)(
    "replaces the empty Active target when %s enters",
    (active, dividerOffset, doneOffset) => {
      const items = [
        pinnedHeader,
        thread("p", "pinned"),
        divider,
        marker("active-placeholder"),
        doneHeader,
        thread("s", "done"),
      ];
      const result = preview(
        { items, doneOrder: [], doneExpanded: true },
        active,
        sidebarMarkerId("active-placeholder"),
      );
      expect(result.get(sidebarMarkerId("active-placeholder"))?.scaleY).toBe(0);
      expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(dividerOffset);
      expect(result.get(sidebarMarkerId("done-header"))?.y).toBe(doneOffset);
    },
  );

  it("uses the canonical done rank and the destination's slim height", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      doneHeader,
      thread("s1", "done"),
      thread("s2", "done"),
    ];
    const result = preview({ items, doneOrder: ["s1", "a", "s2"], doneExpanded: true }, "a", "s2");
    expect(result.get(sidebarMarkerId("done-header"))?.y).toBe(-12);
    expect(result.get("s1")?.y).toBe(-12);
    expect(result.get("s2")?.y).toBe(25);
  });

  it.each([
    ["a1", 49],
    ["a2", 0],
  ] as const)(
    "reserves a full card at the pointer slot over %s when a slim row enters Active",
    (over, firstOffset) => {
      const items = [
        pinnedHeader,
        thread("p", "pinned"),
        divider,
        thread("a1", "active"),
        thread("a2", "active"),
        doneHeader,
        thread("s", "done"),
      ];
      const result = preview({ items, doneOrder: [], doneExpanded: true }, "s", over);
      expect(result.get("a1")?.y).toBe(firstOffset);
      expect(result.get("a2")?.y).toBe(49);
      expect(result.get(sidebarMarkerId("done-header"))?.y).toBe(49);
    },
  );

  it("removes the snoozed header when its last row leaves", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      marker("snoozed-header"),
      thread("z", "snoozed"),
      doneHeader,
      thread("s", "done"),
    ];
    const result = preview({ items, doneOrder: [], doneExpanded: true }, "z", "a");
    expect(result.get(sidebarMarkerId("snoozed-header"))?.scaleY).toBe(0);
    expect(result.get(sidebarMarkerId("done-header"))?.y).toBe(-21);
    expect(result.get("s")?.y).toBe(-21);
  });

  it("keeps a collapsed done target without inserting a hidden row", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      doneHeader,
      marker("done-placeholder"),
    ];
    const result = preview(
      { items, doneOrder: [], doneExpanded: false },
      "a2",
      sidebarMarkerId("done-placeholder"),
    );
    expect(result.get(sidebarMarkerId("done-header"))?.y).toBe(-49);
    expect(result.get(sidebarMarkerId("done-placeholder"))).toEqual({ ...stationary, y: -49 });
  });

  it("preserves a collapsed snoozed header while another section changes", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      marker("snoozed-header"),
      doneHeader,
      marker("done-placeholder"),
    ];
    const result = preview(
      { items, doneOrder: [], doneExpanded: false },
      "a",
      sidebarMarkerId("done-placeholder"),
    );
    expect(result.get(sidebarMarkerId("snoozed-header"))).toEqual({ ...stationary, y: -12 });
  });

  it("previews a time-ordered inbox drop at its time slot, above the Working shelf", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      marker("working-header"),
      thread("w", "working"),
      doneHeader,
      marker("done-placeholder"),
    ];
    const input = { items, doneOrder: [], doneExpanded: false };
    expect(preview(input, "p", "a1").get("a2")?.y).toBe(0);
    const byTime = preview({ ...input, activeOrder: ["a1", "a2", "p"] }, "p", "a1");
    expect(byTime.get("a2")?.y).toBe(-49);
    expect(byTime.get(sidebarMarkerId("working-header"))).toEqual(stationary);
    expect(byTime.get("w")).toEqual(stationary);
  });

  it("derives missing card geometry from the measured root scale", () => {
    const items = [
      pinnedHeader,
      divider,
      marker("active-placeholder"),
      doneHeader,
      thread("s", "done"),
    ];
    const result = preview(
      { items, doneOrder: [], doneExpanded: true },
      "s",
      sidebarMarkerId("pinned-header"),
      0.75,
    );
    expect(result.get(sidebarMarkerId("pinned-header"))).toEqual(stationary);
    expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(37);
    expect(result.get(sidebarMarkerId("active-placeholder"))?.y).toBe(37);
  });

  it("updates the projection when the target or measured geometry changes", () => {
    const strategy = createSidebarSortingStrategy({
      items: pinned,
      doneOrder: [],
      doneExpanded: true,
    });
    const args = layout(pinned, "p1", "p1");
    expect(strategy({ ...args, index: 2 })?.y).toBe(0);
    expect(strategy({ ...args, index: 2, overIndex: 4 })?.y).toBe(-49);
    const smaller = layout(pinned, "p1", "a1", 0.75);
    expect(strategy({ ...smaller, index: 2 })?.y).toBe(-37);
  });

  it.each(["active", "done"] as const)(
    "reveals the mounted empty %s target when its last row leaves and hides it on return",
    (section) => {
      const items = [
        pinnedHeader,
        thread("p", "pinned"),
        divider,
        marker("active-placeholder"),
        thread("a", "active"),
        doneHeader,
        marker("done-placeholder"),
        thread("s", "done"),
      ];
      const active = section === "active" ? "a" : "s";
      const input = { items, doneOrder: ["s"], doneExpanded: true };
      const placeholderId = sidebarMarkerId(`${section}-placeholder`);
      const resting = preview(input, active, active);
      expect(resting.get(placeholderId)?.scaleY).toBe(0);
      const leaving = preview(input, active, sidebarMarkerId("pinned-header"));
      expect(leaving.get(placeholderId)?.scaleY).toBe(1);
      const returning = preview(input, active, active);
      expect(returning.get(placeholderId)?.scaleY).toBe(0);
    },
  );

  it("uses shelf height for empty target sizing when card height differs from its default", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      doneHeader,
      marker("done-placeholder"),
    ];
    const strategy = createSidebarSortingStrategy({
      items,
      doneOrder: [],
      doneExpanded: false,
    });
    const args = layout(items, "a", sidebarMarkerId("done-placeholder"), 1, 78);
    expect(strategy({ ...args, index: 4 })?.y).toBe(-42);
  });

  it("keeps the route row visible after a done drop pushes it beyond the page", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      doneHeader,
      thread("s", "done"),
    ];
    const input = {
      items,
      doneOrder: ["a", "s", "hidden"],
      doneExpanded: true,
      doneVisibleCount: 1,
    };
    const withRoute = preview({ ...input, routeThreadKey: "s" }, "a", "s");
    const withoutRoute = preview(input, "a", "s");
    expect(withRoute.get("s")).toEqual({ ...stationary, y: 25 });
    expect(withoutRoute.get("s")?.scaleY).toBe(0);
  });

  it("reserves the next page row when a visible done thread leaves", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      doneHeader,
      thread("s1", "done"),
      thread("route", "done"),
    ];
    const result = preview(
      {
        items,
        doneOrder: ["s1", "hidden", "route"],
        doneExpanded: true,
        doneVisibleCount: 1,
        routeThreadKey: "route",
      },
      "s1",
      "a",
    );
    expect(result.get(sidebarMarkerId("done-header"))?.y).toBe(49);
    expect(result.get("route")?.y).toBe(49);
  });

  it("keeps the dropped route thread visible in a collapsed done shelf", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      doneHeader,
      marker("done-placeholder"),
    ];
    const result = preview(
      {
        items,
        doneOrder: ["a", "hidden"],
        doneExpanded: false,
        doneVisibleCount: 1,
        routeThreadKey: "a",
      },
      "a",
      sidebarMarkerId("done-placeholder"),
    );
    expect(result.get(sidebarMarkerId("done-placeholder"))?.scaleY).toBe(0);
    expect(result.get(sidebarMarkerId("done-header"))?.y).toBe(-12);
  });

  it("preserves hidden snoozed membership when the only rendered route row leaves", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      marker("snoozed-header"),
      thread("z", "snoozed"),
      doneHeader,
      thread("s", "done"),
    ];
    const result = preview(
      {
        items,
        doneOrder: ["s"],
        doneExpanded: true,
        snoozedThreadCount: 2,
      },
      "z",
      "a",
    );
    expect(result.get(sidebarMarkerId("snoozed-header"))).toEqual({ ...stationary, y: 49 });
    expect(result.get(sidebarMarkerId("done-header"))?.y).toBe(12);
  });
});

describe("lifted card clearance", () => {
  const rect = (top: number, height: number) => ({
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 260,
    width: 260,
  });
  const apply = (cardTop: number, cardHeight: number, y: number, listTop = 136, offset = 32) =>
    restrictBelowSidebarLabel(
      {
        transform: { ...stationary, y },
        containerNodeRect: rect(listTop, 500),
        draggingNodeRect: rect(cardTop, cardHeight),
        activatorEvent: null,
        active: null,
        activeNodeRect: null,
        over: null,
        overlayNodeRect: null,
        scrollableAncestors: [],
        scrollableAncestorRects: [],
        windowRect: null,
      },
      offset,
    );

  it.each([36, 48])("keeps a %ipx row below empty Pins even past the top edge", (height) => {
    for (const pointerY of [150, 136, 100, 0]) {
      const transform = apply(511, height, pointerY - 529);
      expect(511 + transform.y).toBe(168);
    }
  });

  it("preserves pointer movement below the label", () => {
    expect(apply(511, 36, -200).y).toBe(-200);
  });

  it("follows the list when it scrolls and includes content preceding Pins", () => {
    expect(511 + apply(511, 36, -500, 96).y).toBe(128);
    expect(511 + apply(511, 36, -500, 136, 114).y).toBe(250);
  });
});

it("keeps group headings and working rows visible during inbox and Done drag previews", () => {
  const group: SidebarListItem = { kind: "group", key: "project:p", label: "Project" };
  const activeInbox = [group, thread("a", "active"), thread("w", "working")];
  const items = [pinnedHeader, divider, ...activeInbox, doneHeader, thread("d", "done")];
  for (const over of ["a", sidebarMarkerId("done-header")]) {
    const transforms = preview(
      {
        items,
        doneOrder: ["a", "d"],
        doneExpanded: true,
        inbox: { active: activeInbox, other: [group, thread("w", "working")] },
      },
      "a",
      over,
    );
    expect(transforms.get(sidebarListItemId(group))?.scaleY).toBe(1);
    expect(transforms.get("w")?.scaleY).toBe(1);
  }
});

it("reserves a scaled header gap when a drag introduces a new group", () => {
  const existing: SidebarListItem = { kind: "group", key: "project:one", label: "One" };
  const introduced: SidebarListItem = { kind: "group", key: "project:two", label: "Two" };
  const inbox = [existing, thread("a", "active")];
  const items = [
    pinnedHeader,
    thread("p", "pinned"),
    divider,
    ...inbox,
    doneHeader,
    thread("d", "done"),
  ];
  for (const scale of [1, 0.75]) {
    const transforms = preview(
      {
        items,
        doneOrder: ["d"],
        doneExpanded: true,
        inbox: { active: [...inbox, introduced, thread("p", "active")], other: inbox },
      },
      "p",
      "a",
      scale,
    );
    expect(transforms.get(sidebarMarkerId("done-header"))?.y).toBe(32 * scale + 1);
  }
});
