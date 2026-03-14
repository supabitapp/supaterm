---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: $LINEAR_PROJECT_SLUG
  active_states: ["Todo", "In Progress"]
  terminal_states: ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]
polling:
  interval_ms: 5000
workspace:
  root: ./.build/sonata_workspaces
hooks:
  after_create: |
    git clone --depth=1 --recursive git@github.com:supabitapp/supaterm.git .
    mise trust
    mise install
  before_run: |
    git submodule update --init --recursive --depth=1
  timeout_ms: 300000
agent:
  max_concurrent_agents: 2
  max_retry_backoff_ms: 300000
  max_turns: 50
codex:
  command: codex app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
server:
  port: 4310
---
# Supaterm Symphony Workflow

You are working on {{ issue.identifier }}: {{ issue.title }} for Supaterm.

Supaterm is a macOS 26+ Swift app built with Tuist and The Composable Architecture.

Follow these repository rules:

- Read and follow `AGENTS.md` before changing code.
- Prefer focused changes that fit the existing TCA feature structure under `supaterm/`.
- When you change reducer or state logic, add or update tests in `supatermTests/`.
- Use `make check` for formatting and linting.
- Use `make test` when the change affects application logic or behavior.
- Do not commit generated Xcode workspace/project artifacts, build outputs, or other ignored files.
- If a narrower `xcodebuild -only-testing` command is materially faster during iteration, that is acceptable, but end with the strongest relevant validation.

If you are blocked, state the exact blocker and what you verified before stopping.
