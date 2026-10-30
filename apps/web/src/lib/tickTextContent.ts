import { secondTick } from "@supaterm/client-runtime/clock";

export function tickTextContent(format: (nowMs: number) => string, live: boolean) {
  return (node: HTMLElement | null) => {
    if (!node) return;
    const write = () => {
      const text = format(Date.now());
      if (node.textContent !== text) node.textContent = text;
    };
    write();
    return live ? secondTick.subscribe(write) : undefined;
  };
}
