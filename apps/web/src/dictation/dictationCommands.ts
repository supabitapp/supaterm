const COMPOSER_DICTATE_EVENT = "supaterm:composer-dictate";

export function requestComposerDictation(): void {
  window.dispatchEvent(new Event(COMPOSER_DICTATE_EVENT));
}

export function onComposerDictationRequest(listener: () => void): () => void {
  window.addEventListener(COMPOSER_DICTATE_EVENT, listener);
  return () => window.removeEventListener(COMPOSER_DICTATE_EVENT, listener);
}
