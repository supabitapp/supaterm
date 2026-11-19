type AnyFunction = (...args: never) => unknown;

export type ScriptedFunction<F extends AnyFunction> = F & {
  readonly calls: ReadonlyArray<Parameters<F>>;
  readonly implementation: () => F;
  readonly implement: (implementation: F) => ScriptedFunction<F>;
  readonly implementOnce: (implementation: F) => ScriptedFunction<F>;
  readonly returns: (value: ReturnType<F>) => ScriptedFunction<F>;
  readonly returnsOnce: (value: ReturnType<F>) => ScriptedFunction<F>;
  readonly clearCalls: () => void;
  readonly reset: () => void;
};

const unscripted = () => {
  throw new Error("scriptedFunction called without a scripted answer");
};

export function scriptedFunction<F extends AnyFunction>(initial?: F): ScriptedFunction<F>;
export function scriptedFunction(
  initial: (...args: ReadonlyArray<unknown>) => unknown = unscripted,
) {
  const calls: Array<ReadonlyArray<unknown>> = [];
  const queue: Array<(...args: ReadonlyArray<unknown>) => unknown> = [];
  let current = initial;
  let self: unknown;
  const call = (...args: ReadonlyArray<unknown>) => {
    calls.push(args);
    const next = queue.shift() ?? current;
    return next(...args);
  };
  self = Object.assign(call, {
    calls,
    implementation: () => current,
    implement: (implementation: (...args: ReadonlyArray<unknown>) => unknown) => {
      current = implementation;
      return self;
    },
    implementOnce: (implementation: (...args: ReadonlyArray<unknown>) => unknown) => {
      queue.push(implementation);
      return self;
    },
    returns: (value: unknown) => {
      current = () => value;
      return self;
    },
    returnsOnce: (value: unknown) => {
      queue.push(() => value);
      return self;
    },
    clearCalls: () => {
      calls.length = 0;
    },
    reset: () => {
      calls.length = 0;
      queue.length = 0;
      current = initial;
    },
  });
  return self;
}
