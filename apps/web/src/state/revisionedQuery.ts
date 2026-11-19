import * as Option from "effect/Option";
import { Atom, type AtomRegistry } from "effect/reactivity";

const readRevisions = new WeakMap<AtomRegistry.AtomRegistry, WeakMap<object, string | null>>();

const hasNode = (registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<unknown>) =>
  registry.getNodes().has(Atom.isSerializable(atom) ? atom[Atom.SerializableTypeId].key : atom);

const isCached = (registry: AtomRegistry.AtomRegistry, query: Atom.Atom<unknown>) =>
  hasNode(registry, query) ||
  (query.initialValueTarget !== undefined && hasNode(registry, query.initialValueTarget));

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
            : revision !== null && isCached(get.registry, query);
          if (stale) {
            const registry = get.registry;
            queueMicrotask(() => {
              if (isCached(registry, query)) registry.refresh(query);
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

/**
 * Reads `query` under a workspace revision (latest mutation id); a different
 * revision than the last read refetches it. The first read records the revision,
 * and refetches only a query that a reader without a revision already cached.
 * `undefined` reads without taking part, for readers that must not refetch now.
 */
export function revisionedQuery<A>(query: Atom.Atom<A>, revision: string | null | undefined) {
  if (revision === undefined) return query;
  return revisionedFamily(query)(revision) as Atom.Atom<A>;
}
