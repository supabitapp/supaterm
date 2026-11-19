const STORAGE_KEY = "supaterm:snap-shot-setup-resume:v1";
let startupChecked = false;

export function readSnapShotSetupResume() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "enabled" || value === "disabled") return { wasEnabled: value === "enabled" };
  } catch {}
  return null;
}

export function saveSnapShotSetupResume(wasEnabled: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, wasEnabled ? "enabled" : "disabled");
  } catch {}
}

export function clearSnapShotSetupResume() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function shouldResumeSnapShotSetupOnStartup() {
  if (startupChecked) return false;
  startupChecked = true;
  return readSnapShotSetupResume() !== null;
}
