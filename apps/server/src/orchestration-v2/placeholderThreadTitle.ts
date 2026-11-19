export const placeholderThreadTitle: (parentTitle: string, index: number) => string = (
  parentTitle: string,
  index: number,
) => `${parentTitle} thread ${index + 1}`;

export const isPlaceholderThreadTitle = (title: string) => / thread \d+$/u.test(title);
