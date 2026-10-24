import { requireOptionalNativeModule } from "expo";

export type PushApnsEnvironment = "sandbox" | "production";

export type PushNativeConfiguration =
  | { readonly supported: false }
  | {
      readonly supported: true;
      readonly apnsEnvironment: PushApnsEnvironment;
      readonly topic: string;
    };

export interface PushRecipientKey {
  readonly keyId: string;
  readonly publicKey: string;
}

export interface PushBinding {
  readonly registrationId: string;
  readonly keyId: string;
  readonly environmentId: string;
  readonly hostKey: string;
}

export interface PushInstallation {
  readonly installationId: string;
  readonly ownerToken: string;
  readonly token: string;
  readonly topic: string;
  readonly environment: PushApnsEnvironment;
}

export interface SupatermPushModule {
  configuration(): PushNativeConfiguration;
  generateRecipientKey(): Promise<PushRecipientKey>;
  deleteOrphanKeys(): Promise<void>;
  saveBinding(binding: PushBinding): Promise<void>;
  deleteBinding(registrationId: string): Promise<void>;
  listBindings(): Promise<ReadonlyArray<PushBinding>>;
  getHideContent(): Promise<boolean>;
  setHideContent(value: boolean): Promise<void>;
  getInstallation(): Promise<PushInstallation | null>;
  setInstallation(installation: PushInstallation): Promise<void>;
  clearInstallation(): Promise<void>;
}

/** iOS only; null on Android and on builds without the module. */
export default requireOptionalNativeModule<SupatermPushModule>("SupatermPush");
