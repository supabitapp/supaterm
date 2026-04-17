---
name: supaterm-release
description: Prepare and ship Supaterm stable releases. Use when the user asks to bump a Supaterm version, cut a stable release, write or publish release notes, update the `supaterm.com` changelog, or run `make bump-and-release`. Always draft the changelog first and stop for explicit human confirmation before editing `apps/supaterm.com`, creating GitHub release notes, or running the release command.
---

# Supaterm Release

Prepare the release, but do not publish unconfirmed notes.

## Workflow

1. Inspect repo state before doing anything destructive.

Run:

```bash
git status --short
git branch --show-current
git fetch origin
git rev-list --left-right --count origin/$(git branch --show-current)...HEAD
```

If the branch is behind remote, stop and ask the user what to do. If unrelated dirty files exist, leave them alone unless they block the release.

2. Gather the release delta.

Find the previous stable tag and inspect user-facing changes since then.

```bash
gh release list --exclude-drafts --exclude-pre-releases --limit 1 --json tagName --jq '.[0].tagName'
git log --oneline <previous-tag>..HEAD
git log --oneline <previous-tag>..HEAD -- apps/mac
git log --oneline <previous-tag>..HEAD -- apps/supaterm.com
```

Read enough of the touched files or commit bodies to separate user-facing changes from internal churn.

3. Draft the changelog and stop.

Write a proposed changelog entry in the same shape used by `apps/supaterm.com/src/lib/changelog-data.ts`, but do not edit files yet. Keep the draft tight and user-facing.

The draft must include:
- version
- date in `YYYY-MM-DD`
- title
- optional description
- sections with `new`, `improvements`, and `fixes` only when needed

Do not include internal CI, refactors, or maintenance unless they materially affect users.

After drafting, show the exact text to the human and wait for approval. If the human changes wording, revise the draft and ask again. Do not proceed until the changelog text is explicitly confirmed.

4. Apply the confirmed changelog.

After approval, add the new entry at the top of `apps/supaterm.com/src/lib/changelog-data.ts`. Reuse the confirmed wording verbatim except for formatting needed by the file.

5. Validate the website change.

Run:

```bash
make web-check
make web-test
```

If either fails, fix the issue before continuing.

6. Commit only the changelog change.

Stage only the website changelog file. Use a signed commit. Do not use `git add .`.

7. Run the release command only after the changelog commit is ready.

Run:

```bash
make bump-and-release
```

Pass the user-requested version when prompted.

This command updates `apps/mac/Configurations/Project.xcconfig`, creates the bump commit, pushes the branch, creates the annotated tag, and pushes the tag. Never run it before changelog approval because it publishes immediately.

8. Sync the GitHub release notes.

`make bump-and-release` creates the tag, but the GitHub release notes may still be blank. Use the confirmed changelog text as the single source of truth.

Run one of:

```bash
gh release edit vX.Y.Z --title "vX.Y.Z" --notes-file <notes-file>
gh release create vX.Y.Z --draft --verify-tag --title "vX.Y.Z" --notes-file <notes-file>
```

Prefer `gh release edit` when the draft already exists.

9. Report the outcome.

Return:
- the changelog file path
- the changelog commit sha
- the bump commit sha
- the tag
- the release URL
- any workflow run URL still in progress

## Guardrails

- Do not edit the changelog before the human confirms the wording.
- Do not run `make bump-and-release` before the human confirms the wording.
- Do not invent release-note content that is not grounded in the diff.
- Do not touch unrelated dirty files.
- Do not use the browser for GitHub work; use `gh`.
- Keep the website entry and GitHub release notes aligned.
