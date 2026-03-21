export type Direction = "horizontal" | "vertical";

export type SplitNode<T> =
  | { type: "leaf"; id: T }
  | {
      type: "split";
      direction: Direction;
      ratio: number;
      left: SplitNode<T>;
      right: SplitNode<T>;
    };

export interface SplitTree<T> {
  root: SplitNode<T> | null;
  zoomed: SplitNode<T> | null;
}

// --- Constructors ---

export function createTreeWithLeaf<T>(id: T): SplitTree<T> {
  return { root: { type: "leaf", id }, zoomed: null };
}

// --- Queries ---

export function leaves<T>(tree: SplitTree<T>): T[] {
  if (!tree.root) return [];
  return nodeLeaves(tree.root);
}

function nodeLeaves<T>(node: SplitNode<T>): T[] {
  if (node.type === "leaf") return [node.id];
  return [...nodeLeaves(node.left), ...nodeLeaves(node.right)];
}

// --- Mutations (immutable — return new trees) ---

export function insertAt<T>(
  tree: SplitTree<T>,
  target: T,
  newId: T,
  direction: "left" | "right" | "up" | "down",
  eq: (a: T, b: T) => boolean = (a, b) => a === b,
): SplitTree<T> {
  if (!tree.root) return createTreeWithLeaf(newId);

  const splitDirection: Direction =
    direction === "left" || direction === "right" ? "horizontal" : "vertical";
  const insertAsRight = direction === "right" || direction === "down";

  const newRoot = nodeInsertAt(
    tree.root,
    target,
    newId,
    splitDirection,
    insertAsRight,
    eq,
  );
  return { root: newRoot, zoomed: tree.zoomed };
}

function nodeInsertAt<T>(
  node: SplitNode<T>,
  target: T,
  newId: T,
  direction: Direction,
  insertAsRight: boolean,
  eq: (a: T, b: T) => boolean,
): SplitNode<T> {
  if (node.type === "leaf") {
    if (!eq(node.id, target)) return node;
    const newLeaf: SplitNode<T> = { type: "leaf", id: newId };
    return {
      type: "split",
      direction,
      ratio: 0.5,
      left: insertAsRight ? node : newLeaf,
      right: insertAsRight ? newLeaf : node,
    };
  }
  return {
    ...node,
    left: nodeInsertAt(node.left, target, newId, direction, insertAsRight, eq),
    right: nodeInsertAt(
      node.right,
      target,
      newId,
      direction,
      insertAsRight,
      eq,
    ),
  };
}

export function remove<T>(
  tree: SplitTree<T>,
  id: T,
  eq: (a: T, b: T) => boolean = (a, b) => a === b,
): SplitTree<T> {
  if (!tree.root) return tree;
  const newRoot = nodeRemove(tree.root, id, eq);
  // Clear zoom if zoomed node was removed
  let zoomed = tree.zoomed;
  if (zoomed && zoomed.type === "leaf" && eq(zoomed.id, id)) {
    zoomed = null;
  }
  return { root: newRoot, zoomed };
}

function nodeRemove<T>(
  node: SplitNode<T>,
  id: T,
  eq: (a: T, b: T) => boolean,
): SplitNode<T> | null {
  if (node.type === "leaf") {
    return eq(node.id, id) ? null : node;
  }
  const newLeft = nodeRemove(node.left, id, eq);
  const newRight = nodeRemove(node.right, id, eq);
  if (!newLeft && !newRight) return null;
  if (!newLeft) return newRight;
  if (!newRight) return newLeft;
  return { ...node, left: newLeft, right: newRight };
}

function nodeFindLeaf<T>(
  node: SplitNode<T>,
  id: T,
  eq: (a: T, b: T) => boolean,
): SplitNode<T> | null {
  if (node.type === "leaf") return eq(node.id, id) ? node : null;
  return nodeFindLeaf(node.left, id, eq) ?? nodeFindLeaf(node.right, id, eq);
}

export function setZoomed<T>(
  tree: SplitTree<T>,
  id: T | null,
  eq: (a: T, b: T) => boolean = (a, b) => a === b,
): SplitTree<T> {
  if (id === null) return { ...tree, zoomed: null };
  const found = tree.root ? nodeFindLeaf(tree.root, id, eq) : null;
  return { ...tree, zoomed: found };
}

export function equalize<T>(tree: SplitTree<T>): SplitTree<T> {
  if (!tree.root) return tree;
  return { root: nodeEqualize(tree.root), zoomed: tree.zoomed };
}

function nodeEqualize<T>(node: SplitNode<T>): SplitNode<T> {
  if (node.type === "leaf") return node;
  return {
    ...node,
    ratio: 0.5,
    left: nodeEqualize(node.left),
    right: nodeEqualize(node.right),
  };
}

export function resize<T>(
  tree: SplitTree<T>,
  id: T,
  delta: number,
  axis: Direction,
  eq: (a: T, b: T) => boolean = (a, b) => a === b,
): SplitTree<T> {
  if (!tree.root) return tree;
  const newRoot = nodeResize(tree.root, id, delta, axis, eq);
  return { root: newRoot, zoomed: tree.zoomed };
}

function nodeResize<T>(
  node: SplitNode<T>,
  id: T,
  delta: number,
  axis: Direction,
  eq: (a: T, b: T) => boolean,
): SplitNode<T> {
  if (node.type === "leaf") return node;
  if (node.direction !== axis) {
    return {
      ...node,
      left: nodeResize(node.left, id, delta, axis, eq),
      right: nodeResize(node.right, id, delta, axis, eq),
    };
  }

  const inLeft = nodeContains(node.left, id, eq);
  if (inLeft) {
    const newRatio = Math.max(0.1, Math.min(0.9, node.ratio + delta));
    return {
      ...node,
      ratio: newRatio,
      left: nodeResize(node.left, id, delta, axis, eq),
    };
  }

  const inRight = nodeContains(node.right, id, eq);
  if (inRight) {
    const newRatio = Math.max(0.1, Math.min(0.9, node.ratio - delta));
    return {
      ...node,
      ratio: newRatio,
      right: nodeResize(node.right, id, delta, axis, eq),
    };
  }

  return node;
}

function nodeContains<T>(
  node: SplitNode<T>,
  id: T,
  eq: (a: T, b: T) => boolean,
): boolean {
  if (node.type === "leaf") return eq(node.id, id);
  return nodeContains(node.left, id, eq) || nodeContains(node.right, id, eq);
}

// --- Focus Navigation ---

type FocusDirection = "left" | "right" | "up" | "down" | "next" | "previous";

export function focusTarget<T>(
  tree: SplitTree<T>,
  from: T,
  direction: FocusDirection,
  eq: (a: T, b: T) => boolean = (a, b) => a === b,
): T | null {
  const allLeaves = leaves(tree);
  if (allLeaves.length <= 1) return null;

  if (direction === "next" || direction === "previous") {
    const idx = allLeaves.findIndex((l) => eq(l, from));
    if (idx === -1) return null;
    if (direction === "next") {
      return allLeaves[(idx + 1) % allLeaves.length] ?? null;
    }
    return allLeaves[(idx - 1 + allLeaves.length) % allLeaves.length] ?? null;
  }

  // Spatial navigation — use tree structure
  if (!tree.root) return null;
  return spatialFocusTarget(tree.root, from, direction, eq);
}

function spatialFocusTarget<T>(
  node: SplitNode<T>,
  from: T,
  direction: "left" | "right" | "up" | "down",
  eq: (a: T, b: T) => boolean,
): T | null {
  if (node.type === "leaf") return null;

  const isHorizontal = node.direction === "horizontal";
  const isVertical = node.direction === "vertical";
  const inLeft = nodeContains(node.left, from, eq);
  const inRight = nodeContains(node.right, from, eq);

  // Matching axis — can navigate across the split
  if (
    (isHorizontal && (direction === "left" || direction === "right")) ||
    (isVertical && (direction === "up" || direction === "down"))
  ) {
    const goingToRight =
      direction === "right" || direction === "down";
    if (inLeft && goingToRight) {
      return firstLeaf(node.right);
    }
    if (inRight && !goingToRight) {
      return lastLeaf(node.left);
    }
  }

  if (inLeft) return spatialFocusTarget(node.left, from, direction, eq);
  if (inRight) return spatialFocusTarget(node.right, from, direction, eq);
  return null;
}

function firstLeaf<T>(node: SplitNode<T>): T {
  if (node.type === "leaf") return node.id;
  return firstLeaf(node.left);
}

function lastLeaf<T>(node: SplitNode<T>): T {
  if (node.type === "leaf") return node.id;
  return lastLeaf(node.right);
}

export function focusTargetAfterClosing<T>(
  tree: SplitTree<T>,
  closingId: T,
  eq: (a: T, b: T) => boolean = (a, b) => a === b,
): T | null {
  const allLeaves = leaves(tree);
  const idx = allLeaves.findIndex((l) => eq(l, closingId));
  if (idx === -1) return null;
  // Prefer next, then previous
  if (idx + 1 < allLeaves.length) return allLeaves[idx + 1]!;
  if (idx - 1 >= 0) return allLeaves[idx - 1]!;
  return null;
}
