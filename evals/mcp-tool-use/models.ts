export const MODELS = {
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-opus-5-5": "Opus 5.5",
  "gpt-6.1-sol": "GPT-6.1 Sol",
  "gpt-6-astra": "GPT-6 Astra",
} as const;

export type Model = keyof typeof MODELS;

export const isCodex = (model: Model): model is Extract<Model, `gpt-${string}`> =>
  model.startsWith("gpt-");

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export const PRICES = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};

export type PricedModel = keyof typeof PRICES;
