import { ensureClientSettingsHydrated, persistClientSettingsUpdate } from "../hooks/useSettings";

export async function completeOnboarding() {
  await ensureClientSettingsHydrated();
  const onboardingCompletedAt = new Date().toISOString();
  await persistClientSettingsUpdate((current) => ({ ...current, onboardingCompletedAt }));
}
