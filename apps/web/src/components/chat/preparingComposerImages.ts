import { create } from "zustand";

export interface PreparingComposerImage {
  readonly id: string;
  readonly name: string;
  readonly file: File;
}

const NO_PREPARING_IMAGES: ReadonlyArray<PreparingComposerImage> = [];

const usePreparingComposerImageStore = create<{
  readonly byTargetKey: Readonly<Record<string, ReadonlyArray<PreparingComposerImage>>>;
}>(() => ({ byTargetKey: {} }));

export function usePreparingComposerImages(targetKey: string) {
  return usePreparingComposerImageStore(
    (state) => state.byTargetKey[targetKey] ?? NO_PREPARING_IMAGES,
  );
}

export function countPreparingComposerImages(targetKey: string): number {
  return usePreparingComposerImageStore.getState().byTargetKey[targetKey]?.length ?? 0;
}

export function addPreparingComposerImages(
  targetKey: string,
  images: ReadonlyArray<PreparingComposerImage>,
): void {
  usePreparingComposerImageStore.setState((state) => ({
    byTargetKey: {
      ...state.byTargetKey,
      [targetKey]: [...(state.byTargetKey[targetKey] ?? NO_PREPARING_IMAGES), ...images],
    },
  }));
}

export function isPreparingComposerImage(targetKey: string, imageId: string): boolean {
  return (
    usePreparingComposerImageStore
      .getState()
      .byTargetKey[targetKey]?.some((image) => image.id === imageId) ?? false
  );
}

export function removePreparingComposerImages(
  targetKey: string,
  imageIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const current =
    usePreparingComposerImageStore.getState().byTargetKey[targetKey] ?? NO_PREPARING_IMAGES;
  const removed = new Set(
    current.filter((image) => imageIds.has(image.id)).map((image) => image.id),
  );
  if (removed.size === 0) return removed;
  usePreparingComposerImageStore.setState((state) => {
    const remaining = (state.byTargetKey[targetKey] ?? NO_PREPARING_IMAGES).filter(
      (image) => !removed.has(image.id),
    );
    const byTargetKey = { ...state.byTargetKey };
    if (remaining.length > 0) {
      byTargetKey[targetKey] = remaining;
    } else {
      delete byTargetKey[targetKey];
    }
    return { byTargetKey };
  });
  return removed;
}
