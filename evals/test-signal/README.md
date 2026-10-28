# Test signal

Runs the Macroscope `test-signal` check ([`.macroscope/check-run-agents/test-signal.md`](../../.macroscope/check-run-agents/test-signal.md)) on real and synthetic test diffs, and checks that a cheap model flags low-signal tests and leaves good ones alone. Use it to cut the check to the fewest words that still work.

The model gets the check body, the captured PR test diff, `read_file` and `grep` over its frozen source context, and `post_comment`. Case inputs are committed under `fixtures/`; no additional Git history is needed. The wrapper prompt around the body is a stand-in for Macroscope's, which is not public.

## Run

```sh
cd evals
pnpm test-signal --dry-run
pnpm test-signal --out runs/baseline
pnpm test-signal --out runs/cut --prompt /path/to/variant.md --case new-table-row
```

- Set `SUPATERM_EVAL_BASE_URL` to a Responses-compatible endpoint. Set `SUPATERM_EVAL_API_KEY` for bearer authentication, or `SUPATERM_EVAL_HEADERS` for a JSON object of headers. No local provider configuration or credentials are read. Default models: `gpt-6.1-terra` and `gpt-6-luna`. Pass `--model` once per model to change them.
- `--dry-run` builds every selected case and checks its target ranges without calling a model.
- Flags: `--prompt <file>` (a variant of the check, default the real one), `--case <id>` (repeatable), `--samples <n>` (default 2, and a 3rd when the first 2 disagree), `--concurrency <n>` (default 6), `--reasoning <level>` (default `low`, as the check runs).
- A bad case passes when a comment lands inside a target test. A guard case passes when the check posts nothing and replies exactly `All clear`.
- `summary.md` gives the prompt hash and word count, then per model: bad cases caught, guards clean, errors, and tokens.
- Cost varies by configured provider and model. Run a single case first; dry runs do not call a model.

## Add a case

Add an entry to `cases.ts` and its `fixtures/<id>.json` snapshot. The snapshot contains the test diff and a `files` map of source paths to their contents at the reviewed head, including the context needed to judge the change. Keep the source attribution in the case. Bad cases list the titles of the tests to flag. Run `--dry-run --case <id>` and the fixture tests before calling a model.
