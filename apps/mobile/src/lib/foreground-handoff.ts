let activeHandoffs = 0;

export function beginForegroundHandoff(): () => void {
  activeHandoffs += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeHandoffs -= 1;
  };
}

export function isForegroundHandoffActive(): boolean {
  return activeHandoffs > 0;
}
