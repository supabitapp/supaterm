import type { ProviderInstanceId } from "@supaterm/contracts";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";

export interface ModelSlugItem {
  readonly slug: string;
}

export interface ProviderModelItem extends ModelSlugItem {
  readonly instanceId: ProviderInstanceId;
}

export function providerModelKey(instanceId: ProviderInstanceId, slug: string) {
  return `${instanceId}:${slug}`;
}

function rankByValue(values: ReadonlyArray<string>) {
  return new Map(Arr.map(values, (value, index) => [value, index] as const));
}

function toSet(
  values: ReadonlySet<string> | ReadonlyArray<string> | undefined,
): ReadonlySet<string>;
function toSet(values: ReadonlySet<string> | ReadonlyArray<string> | undefined) {
  return (values instanceof Set ? values : new Set(values ?? [])) satisfies ReadonlySet<string>;
}

function byOptionalRank<T>(rank: (item: T) => number | undefined) {
  return Order.mapInput(Order.Number, (item: T) => rank(item) ?? Number.POSITIVE_INFINITY);
}

function byTrueFirst<T>(predicate: (item: T) => boolean) {
  return Order.mapInput(Order.flip(Order.Boolean), predicate);
}

export function sortModelsForProviderInstance<T extends ModelSlugItem>(
  models: ReadonlyArray<T>,
  options?: {
    readonly modelOrder?: ReadonlyArray<string>;
    readonly favoriteModels?: ReadonlySet<string> | ReadonlyArray<string>;
    readonly groupFavorites?: boolean;
  },
) {
  const modelOrder = options?.modelOrder ?? [];
  const favoriteModels = toSet(options?.favoriteModels);
  const orderBySlug = rankByValue(modelOrder);
  const originalOrder = rankByValue(Arr.map(models, (model) => model.slug));
  const orders: Array<Order.Order<T>> = [
    ...(options?.groupFavorites === true
      ? [byTrueFirst<T>((model) => favoriteModels.has(model.slug))]
      : []),
    byOptionalRank((model) => orderBySlug.get(model.slug)),
    byOptionalRank((model) => originalOrder.get(model.slug)),
  ];

  return Arr.sort(models, Order.combineAll(orders));
}

export function sortProviderModelItems<T extends ProviderModelItem>(
  items: ReadonlyArray<T>,
  options?: {
    readonly favoriteModelKeys?: ReadonlySet<string> | ReadonlyArray<string>;
    readonly groupFavorites?: boolean;
    readonly instanceOrder?: ReadonlyArray<ProviderInstanceId>;
  },
) {
  const favoriteModelKeys = toSet(options?.favoriteModelKeys);
  const instanceOrder = new Map(
    Arr.map(options?.instanceOrder ?? [], (instanceId, index) => [instanceId, index] as const),
  );
  const originalOrder = rankByValue(
    Arr.map(items, (item) => providerModelKey(item.instanceId, item.slug)),
  );
  const orders: Array<Order.Order<T>> = [
    ...(options?.groupFavorites === true
      ? [
          byTrueFirst<T>((item) =>
            favoriteModelKeys.has(providerModelKey(item.instanceId, item.slug)),
          ),
        ]
      : []),
    byOptionalRank((item) => instanceOrder.get(item.instanceId)),
    byOptionalRank((item) => originalOrder.get(providerModelKey(item.instanceId, item.slug))),
  ];

  return Arr.sort(items, Order.combineAll(orders));
}
