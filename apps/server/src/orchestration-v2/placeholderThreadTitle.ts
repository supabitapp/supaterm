export const placeholderThreadTitle = (parentTitle: string, index: number): string =>
  `${parentTitle} thread ${index + 1}`;

export const isPlaceholderThreadTitle = (title: string): boolean => / thread \d+$/u.test(title);
