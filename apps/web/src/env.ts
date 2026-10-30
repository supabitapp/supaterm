/**
 * The preload script sets window.desktopBridge via contextBridge before any web-app
 * code executes, so this is reliable at module load time.
 */
export const isElectron = typeof window !== "undefined" && window.desktopBridge !== undefined;

export const isSecretsFeatureEnabled = ["1", "true"].includes(
  import.meta.env.SUPATERM_FEATURE_SECRETS?.trim().toLowerCase() ?? "",
);
