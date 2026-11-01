/** Reconcile closes removed/replaced scopes before creating replacements: at most one live instance per id. */
import type { ProviderInstanceConfigMap } from "@supaterm/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface ProviderInstanceRegistryMutatorShape {
  readonly reconcile: (configMap: ProviderInstanceConfigMap) => Effect.Effect<void>;
}

export class ProviderInstanceRegistryMutator extends Context.Service<
  ProviderInstanceRegistryMutator,
  ProviderInstanceRegistryMutatorShape
>()("supaterm/provider/ProviderInstanceRegistryMutator") {}
