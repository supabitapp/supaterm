import { makeSecretProviderDefinitionRegistry } from "@supaterm/secret-provider-core/shared/definition";
import * as OnePassword from "@supaterm/secret-provider-onepassword/shared/definition";

export const builtInSecretProviderDefinitions = makeSecretProviderDefinitionRegistry([
  OnePassword.definition,
]);
