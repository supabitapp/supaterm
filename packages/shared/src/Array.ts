export function copySorted<T>(values: ReadonlyArray<T>, compareFn?: (left: T, right: T) => number) {
  return [...values].sort(compareFn);
}
