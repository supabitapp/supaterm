type Tick = (dt: number) => void;

/** Where the pointer last was in client px, NaN while it is away. */
export const pointer = { x: Number.NaN, y: Number.NaN };

const ticks = new Set<Tick>();
const moves = new Set<() => void>();
let frame = 0;
let last = 0;
let listening = false;

function loop(now: number) {
  frame = 0;
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  for (const tick of ticks) tick(dt);
  if (ticks.size > 0) frame = requestAnimationFrame(loop);
}

function start() {
  if (frame || document.hidden) return;
  last = 0;
  frame = requestAnimationFrame(loop);
}

function stop() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

function listen() {
  if (listening) return;
  listening = true;
  const moved = () => {
    for (const move of moves) move();
  };
  const away = () => {
    pointer.x = Number.NaN;
    pointer.y = Number.NaN;
    moved();
  };
  document.addEventListener(
    "pointermove",
    (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      moved();
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", away);
  window.addEventListener("blur", away);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (ticks.size > 0) start();
  });
}

/** One animation loop for every bolt computer on the page, asleep while the tab is hidden. */
export function subscribe(tick: Tick): () => void {
  listen();
  ticks.add(tick);
  start();
  return () => {
    ticks.delete(tick);
    if (ticks.size === 0) stop();
  };
}

export function onPointerMove(move: () => void): () => void {
  listen();
  moves.add(move);
  return () => {
    moves.delete(move);
  };
}
