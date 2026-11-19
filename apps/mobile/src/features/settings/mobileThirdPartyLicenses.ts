import {
  decodeThirdPartyLicenseManifest,
  type ThirdPartyLicenseManifest,
} from "@supaterm/shared/thirdPartyLicenses";

let cachedManifest: ThirdPartyLicenseManifest | undefined;

export function getMobileThirdPartyLicenses() {
  if (cachedManifest) return cachedManifest satisfies ThirdPartyLicenseManifest;
  const generatedManifest: unknown = require("@supaterm/mobile-third-party-licenses");
  cachedManifest = decodeThirdPartyLicenseManifest(generatedManifest);
  return cachedManifest satisfies ThirdPartyLicenseManifest;
}
