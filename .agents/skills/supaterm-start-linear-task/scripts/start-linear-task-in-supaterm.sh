#!/usr/bin/env bash
set -euo pipefail

issue_identifier=""
space=""
launch_mode="tab"
direction="right"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --space)
      [[ $# -ge 2 ]] || {
        echo "missing value for --space" >&2
        exit 1
      }
      space="$2"
      shift 2
      ;;
    --pane)
      launch_mode="pane"
      shift
      ;;
    --tab)
      launch_mode="tab"
      shift
      ;;
    --direction)
      [[ $# -ge 2 ]] || {
        echo "missing value for --direction" >&2
        exit 1
      }
      direction="$2"
      shift 2
      ;;
    -h|--help)
      echo "usage: $(basename "$0") <ISSUE-ID> [--tab|--pane] [--direction up|down|left|right] [--space N]"
      exit 0
      ;;
    -*)
      echo "unknown option: $1" >&2
      exit 1
      ;;
    *)
      [[ -z "$issue_identifier" ]] || {
        echo "unexpected argument: $1" >&2
        exit 1
      }
      issue_identifier="$1"
      shift
      ;;
  esac
done

[[ -n "$issue_identifier" ]] || {
  echo "issue identifier is required" >&2
  exit 1
}

case "$direction" in
  up|down|left|right) ;;
  *)
    echo "direction must be one of: up, down, left, right" >&2
    exit 1
    ;;
esac

[[ "$launch_mode" != "pane" || -z "$space" ]] || {
  echo "--space is only supported when launching a tab" >&2
  exit 1
}

for tool in git jq linear sp codex make; do
  command -v "$tool" >/dev/null || {
    echo "missing required tool: $tool" >&2
    exit 1
  }
done

sp instance ls >/dev/null

if [[ "$launch_mode" == "tab" && -z "${SUPATERM_SURFACE_ID:-}" && -z "${SUPATERM_TAB_ID:-}" && -z "$space" ]]; then
  echo "outside Supaterm, pass --space <n> for tab launches" >&2
  exit 1
fi

resolve_worktree_path() {
  local branch_name="$1"
  git worktree list --porcelain | awk -v target="refs/heads/$branch_name" '
    $1 == "worktree" { path = $2; next }
    $1 == "branch" && $2 == target { print path; exit }
  '
}

issue_json=$(linear issue view "$issue_identifier" --json --no-comments)
issue_identifier=$(jq -r '.identifier' <<<"$issue_json")
issue_title=$(jq -r '.title' <<<"$issue_json")
branch_name=$(jq -r '.branchName // empty' <<<"$issue_json")
issue_context=$(jq '
  def label_names:
    if .labels == null then []
    elif (.labels | type) == "array" then [.labels[] | .name // .]
    elif (.labels.nodes? | type) == "array" then [.labels.nodes[] | .name // .]
    else []
    end;
  {
    identifier,
    title,
    description: (.description // ""),
    state: (.state.name // .state // null),
    priority: (.priorityLabel // .priority // null),
    assignee: (.assignee.name // .assignee.email // null),
    project: (.project.name // .project // null),
    team: (.team.name // .team // null),
    labels: label_names,
    branchName,
    url
  }
' <<<"$issue_json")

if [[ -z "$branch_name" || "$branch_name" == "null" ]]; then
  issue_slug=$(printf '%s' "$issue_title" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
  branch_name="${issue_identifier,,}"
  [[ -z "$issue_slug" ]] || branch_name="$branch_name-$issue_slug"
fi

repo_root=$(git rev-parse --show-toplevel)
existing_worktree=$(resolve_worktree_path "$branch_name")
worktree_existed=false

if [[ -n "$existing_worktree" ]]; then
  worktree_path="$existing_worktree"
  worktree_existed=true
else
  if command -v wt >/dev/null 2>&1; then
    worktree_root=$(wt base)
  else
    worktree_root="$repo_root/.worktrees"
  fi
  worktree_path="$worktree_root/$branch_name"
fi

prompt=$(cat <<EOF
You are working on a Linear ticket $issue_identifier under a dedicated worktree.

Issue details:
$issue_context

- Use the issue details above instead of fetching the ticket again
- Evaluate the ticket against the code in this worktree
- Come up with a plan to address it
EOF
)

quoted_branch_name=$(jq -rn --arg value "$branch_name" '$value | @sh')
quoted_prompt=$(jq -rn --arg value "$prompt" '$value | @sh')
quoted_repo_root=$(jq -rn --arg value "$repo_root" '$value | @sh')

if [[ "$worktree_existed" == true ]]; then
  quoted_worktree_path=$(jq -rn --arg value "$worktree_path" '$value | @sh')
  launch_script=$(cat <<EOF
cd $quoted_worktree_path &&
codex $quoted_prompt
EOF
)
else
  launch_script=$(cat <<EOF
cd $quoted_repo_root &&
make worktree-create WORKTREE=$quoted_branch_name &&
worktree_path=\$(git worktree list --porcelain | awk -v target="refs/heads/$branch_name" '\$1 == "worktree" { path = \$2; next } \$1 == "branch" && \$2 == target { print path; exit }') &&
test -n "\$worktree_path" &&
cd "\$worktree_path" &&
codex $quoted_prompt
EOF
)
fi

quoted_launch_script=$(jq -rn --arg value "$launch_script" '$value | @sh')

if [[ "$launch_mode" == "pane" ]]; then
  sp_args=(pane split --json --no-focus --cwd "$repo_root" "$direction" --shell "zsh -lc $quoted_launch_script")
else
  sp_args=(tab new --json --no-focus --cwd "$repo_root")
  if [[ -n "$space" ]]; then
    sp_args+=(--in "$space")
  fi
  sp_args+=(--shell "zsh -lc $quoted_launch_script")
fi

surface_json=$(sp "${sp_args[@]}")

jq -n \
  --arg issue "$issue_identifier" \
  --arg title "$issue_title" \
  --arg branch "$branch_name" \
  --arg worktree "$worktree_path" \
  --arg launchMode "$launch_mode" \
  --arg direction "$direction" \
  --argjson worktreeExisted "$worktree_existed" \
  --argjson surface "$surface_json" \
  '{
    issue: $issue,
    title: $title,
    branch: $branch,
    worktree: $worktree,
    worktreeExisted: $worktreeExisted,
    launchMode: $launchMode,
    direction: (if $launchMode == "pane" then $direction else null end),
    surface: $surface
  }'
