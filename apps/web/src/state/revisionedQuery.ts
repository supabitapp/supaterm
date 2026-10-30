import * as Option from "effect/Option";
import { Atom, type AtomRegistry } from "effect/reactivity";

const readRevisions = new WeakMap<AtomRegistry.AtomRegistry, WeakMap<object, string | null>>();

const queryKey = (query: Atom.Atom<unknown>) =>
  Atom.isSerializable(query) ? query[Atom.SerializableTypeId].key : query;

const makeRevisionedFamily = (query: Atom.Atom<unknown>) =>
  Atom.family((revision: string | null) =>
    Atom.readable(
      (get) => {
        if (Option.isNone(get.self())) {
          let revisions = readRevisions.get(get.registry);
          if (revisions === undefined) {
            revisions = new WeakMap();
            readRevisions.set(get.registry, revisions);
          }
          const stale = revisions.has(query)
            ? revisions.get(query) !== revision
            : // A reader without a revision may have cached it before the latest
              revision !== null && get.registry.getNodes().has(queryKey(query));
          // Deferred: this builds while React renders, and a refresh would synchronously
          // re-render the query's other readers, which React rejects.
          if (stale) {
            const registry = get.registry;
            queueMicrotask(() => {
              // No node, as after the registry is disposed: nothing cached to refetch.
              if (registry.getNodes().has(queryKey(query))) registry.refresh(query);
            });
          }
          revisions.set(query, revision);
        }
        return get(query);
      },
      (refresh) => refresh(query),
    ),
  );

const revisionedFamilies = new WeakMap<
  Atom.Atom<unknown>,
  ReturnType<typeof makeRevisionedFamily>
>();
const revisionedFamily = (query: Atom.Atom<unknown>) => {
  let family = revisionedFamilies.get(query);
  if (family === undefined) {
    family = makeRevisionedFamily(query);
    revisionedFamilies.set(query, family);
  }
  return family;
};

export function revisionedQuery<A>(
  query: Atom.Atom<A>,
  revision: string | null | undefined,
): Atom.Atom<A> {
  if (revision === undefined) return query;
  return revisionedFamily(query)(revision) as Atom.Atom<A>;
}
