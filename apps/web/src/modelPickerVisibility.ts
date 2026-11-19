let mountedModelPickers = 0;
const listeners = new Set<() => void>();

function setMountedModelPickers(next: number) {
  const wasOpen = mountedModelPickers > 0;
  mountedModelPickers = next;
  if (wasOpen === mountedModelPickers > 0) return;
  for (const listener of listeners) listener();
}

export function registerModelPickerContent() {
  setMountedModelPickers(mountedModelPickers + 1);
  return () => {
    setMountedModelPickers(mountedModelPickers - 1);
  };
}

export function isModelPickerOpen() {
  return mountedModelPickers > 0;
}

export function subscribeToModelPickerVisibility(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
