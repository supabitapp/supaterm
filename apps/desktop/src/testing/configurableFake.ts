import { vi } from "vite-plus/test";

type AnyFunction = (...args: never[]) => unknown;

type Implementation<F extends AnyFunction> = (...args: Parameters<F>) => ReturnType<F>;

type Recorder<F extends AnyFunction> = Pick<
  ReturnType<typeof vi.fn<Implementation<F>>>,
  "mock" | "mockClear"
>;

export type FakeControls<F extends AnyFunction> = {
  readonly implementation: () => Implementation<F>;
  readonly reset: (next?: F) => ConfigurableFake<F>;
  readonly implement: (next: F) => ConfigurableFake<F>;
  readonly implementOnce: (next: F) => ConfigurableFake<F>;
  readonly returns: (value: ReturnType<F>) => ConfigurableFake<F>;
  readonly returnsOnce: (value: ReturnType<F>) => ConfigurableFake<F>;
  readonly resolves: (value: Awaited<ReturnType<F>>) => ConfigurableFake<F>;
  readonly resolvesOnce: (value: Awaited<ReturnType<F>>) => ConfigurableFake<F>;
  readonly rejects: (error: unknown) => ConfigurableFake<F>;
  readonly rejectsOnce: (error: unknown) => ConfigurableFake<F>;
};

export type ConfigurableFake<F extends AnyFunction> = F & Recorder<F> & FakeControls<F>;

export const configurableFake = <F extends AnyFunction>(initial: F) => {
  const initialImplementation = initial as unknown as Implementation<F>;
  let current = initialImplementation;
  const queued: Array<Implementation<F>> = [];
  const target = {
    call: function (this: unknown, ...args: Parameters<F>) {
      return (queued.shift() ?? current).apply(this, args);
    },
  };
  const recorder = vi.spyOn(target, "call");
  const implement = (next: Implementation<F>) => {
    current = next;
    return configured;
  };
  const implementOnce = (next: Implementation<F>) => {
    queued.push(next);
    return configured;
  };
  const controls: FakeControls<F> = {
    implementation: () => current,
    reset: (next) => {
      current = next === undefined ? initialImplementation : (next as unknown as Implementation<F>);
      queued.length = 0;
      recorder.mockClear();
      return configured;
    },
    implement: (next) => implement(next as unknown as Implementation<F>),
    implementOnce: (next) => implementOnce(next as unknown as Implementation<F>),
    returns: (value) => implement(() => value),
    returnsOnce: (value) => implementOnce(() => value),
    resolves: (value) => implement(() => Promise.resolve(value) as ReturnType<F>),
    resolvesOnce: (value) => implementOnce(() => Promise.resolve(value) as ReturnType<F>),
    rejects: (error) => implement(() => Promise.reject(error) as ReturnType<F>),
    rejectsOnce: (error) => implementOnce(() => Promise.reject(error) as ReturnType<F>),
  };
  const configured: ConfigurableFake<F> = Object.assign(
    target.call as unknown as F & Recorder<F>,
    controls,
  );
  return configured;
};

export const emptyFake = <F extends AnyFunction>() =>
  configurableFake<F>((() => undefined) as unknown as F);
