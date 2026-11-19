const PROVIDER_ENV_PREFIXES = ["ANTHROPIC_", "CLAUDE_", "CODEX_", "OPENAI_", "SUPATERM_"];

const KEPT_ENV = new Set([
  "SUPATERM_TRANSFER_BUDGET_REPORT_PATH",
  "SUPATERM_TRANSFER_BUDGET_RESULT_PATH",
  "SUPATERM_TRANSFER_BUDGET_SCENARIOS_PATH",
  "SUPATERM_TEST_HEADLESS_SHELL",
]);

if (process.env.SUPATERM_TEST_KEEP_PROVIDER_ENV !== "1") {
  for (const key of Object.keys(process.env)) {
    if (KEPT_ENV.has(key)) continue;
    if (PROVIDER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete process.env[key];
    }
  }
}
