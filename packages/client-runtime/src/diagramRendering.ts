import {
  acceptsDiagramSource,
  diagramOptions,
  isDiagram,
  type Diagram,
  type DiagramOptions,
  type MathResolver,
} from "@supaterm/mermaid/diagram";

// Typeset and literal math labels lay out differently, so they never share a cache entry.
const diagramKey = (source: string, options: DiagramOptions, math: MathResolver | undefined) =>
  JSON.stringify(
    math ? [source, diagramOptions(options), "math"] : [source, diagramOptions(options)],
  );

export function createDiagramRenderer(
  render: (
    source: string,
    options: ReturnType<typeof diagramOptions>,
    math: MathResolver | undefined,
  ) => Promise<Diagram | null>,
  options: {
    maxPending?: number;
    maxCacheEntries?: number;
    maxCacheBytes?: number;
  } = {},
) {
  const maxPending = options.maxPending ?? 32;
  const maxCacheEntries = options.maxCacheEntries ?? 128;
  const maxCacheBytes = options.maxCacheBytes ?? 2 * 1024 * 1024;
  const cache = new Map<string, { output: Diagram | null; bytes: number }>();
  const pending = new Map<string, Promise<Diagram | null>>();
  const queue: Array<{
    key: string;
    source: string;
    options: ReturnType<typeof diagramOptions>;
    math: MathResolver | undefined;
    resolve: (output: Diagram | null) => void;
  }> = [];
  let cacheBytes = 0;
  let running = false;

  function remember(key: string, output: Diagram | null) {
    const bytes = (key.length + (output?.svg.length ?? 0)) * 2;
    if (maxCacheEntries <= 0 || bytes > maxCacheBytes) return;
    while (cache.size >= maxCacheEntries || cacheBytes + bytes > maxCacheBytes) {
      const oldest = cache.entries().next().value;
      if (!oldest) break;
      cache.delete(oldest[0]);
      cacheBytes -= oldest[1].bytes;
    }
    cache.set(key, { output, bytes });
    cacheBytes += bytes;
  }

  async function drain() {
    if (running) return;
    running = true;
    for (let request = queue.shift(); request; request = queue.shift()) {
      let output: Diagram | null = null;
      try {
        const rendered = await render(request.source, request.options, request.math);
        if (isDiagram(rendered)) output = rendered;
        remember(request.key, output);
      } catch {
        output = null;
      }
      pending.delete(request.key);
      request.resolve(output);
    }
    running = false;
  }

  return {
    render(
      source: string,
      options: DiagramOptions = {},
      math?: MathResolver,
    ): Promise<Diagram | null> {
      if (!acceptsDiagramSource(source)) return Promise.resolve(null);
      const normalized = diagramOptions(options);
      const key = diagramKey(source, options, math);
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key);
        cache.set(key, cached);
        return Promise.resolve(cached.output);
      }
      const existing = pending.get(key);
      if (existing) return existing;
      if (pending.size >= maxPending) return Promise.resolve(null);
      const promise = new Promise<Diagram | null>((resolve) => {
        queue.push({ key, source, options: normalized, math, resolve });
      });
      pending.set(key, promise);
      void drain();
      return promise;
    },
    /** A finished render for these inputs, so a remounted view can draw it in the same frame. */
    peek(source: string, options: DiagramOptions = {}, math?: MathResolver) {
      return cache.get(diagramKey(source, options, math))?.output;
    },
  };
}
