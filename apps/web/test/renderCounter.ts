interface Fiber {
  readonly tag: number;
  readonly type: unknown;
  readonly flags: number;
  readonly alternate: Fiber | null;
  readonly child: Fiber | null;
  readonly sibling: Fiber | null;
}

export interface RenderReport {
  readonly commits: number;
  readonly renders: number;
  readonly components: Readonly<Record<string, number>>;
}

const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
const PERFORMED_WORK = 1;

function nameOf(fiber: Fiber) {
  const type = fiber.type as {
    displayName?: string;
    name?: string;
    type?: { displayName?: string; name?: string };
    render?: { displayName?: string; name?: string };
  } | null;
  if (!type || (typeof type !== "object" && typeof type !== "function")) return null;
  const inner = type.type ?? type.render ?? type;
  const raw = type.displayName || inner.displayName || inner.name || "";
  return raw.replace(/^(Forget\(|Memo\()+|\)+$/g, "") || "Anonymous";
}

const STATE = Symbol.for("supaterm.renderCounter");
const state = ((globalThis as { [STATE]?: CounterState })[STATE] ??= {
  on: false,
  commits: 0,
  everCommitted: 0,
  counts: new Map(),
});

interface CounterState {
  on: boolean;
  commits: number;
  everCommitted: number;
  counts: Map<string, number>;
}

function visit(fiber: Fiber | null) {
  let rendered = 0;
  for (let node = fiber; node; node = node.sibling) {
    const performed =
      COMPONENT_TAGS.has(node.tag) && (node.flags & PERFORMED_WORK) === PERFORMED_WORK;
    const name = performed ? nameOf(node) : null;
    if (name) {
      state.counts.set(name, (state.counts.get(name) ?? 0) + 1);
      rendered += 1;
    }
    const skipped = node.alternate !== null && node.child === node.alternate.child && !performed;
    if (node.child && !skipped) rendered += visit(node.child);
  }
  return rendered;
}

if (!("__REACT_DEVTOOLS_GLOBAL_HOOK__" in globalThis))
  Object.assign(globalThis, {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      checkDCE: () => {},
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      onCommitFiberRoot: (_id: unknown, root: { current: Fiber }) => {
        state.everCommitted += 1;
        if (state.on && visit(root.current.child) > 0) state.commits += 1;
      },
    },
  });

/** Every commit since load, counted or not, so a scenario can wait for the tree to go quiet. */
export function commitsSoFar() {
  return state.everCommitted;
}

export function startCounting() {
  state.commits = 0;
  state.counts = new Map();
  state.on = true;
}

export function stopCounting() {
  state.on = false;
  const sorted = [...state.counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  return {
    commits: state.commits,
    renders: sorted.reduce((total, [, count]) => total + count, 0),
    components: Object.fromEntries(sorted),
  };
}
