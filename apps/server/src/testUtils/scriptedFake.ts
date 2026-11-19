import { vi, type Mock } from "vite-plus/test";

export const scriptedFake = <F extends (...args: never) => unknown>(initial: F) => {
  const script: { current: F; readonly once: Array<F> } = { current: initial, once: [] };
  const fake = vi.fn((...args: ReadonlyArray<unknown>) => {
    const next = (script.once.shift() ?? script.current) as unknown as (
      ...args: ReadonlyArray<unknown>
    ) => unknown;
    return next(...args);
  }) as unknown as Mock<F>;
  return Object.assign(fake, {
    implementation: () => script.current,
    use: (next: F) => {
      script.current = next;
    },
    useOnce: (next: F) => {
      script.once.push(next);
    },
  });
};
