---
name: supaterm-release
description: Prepare and ship Supaterm CalVer stable releases. Use when the user asks to bump a Supaterm version, cut a stable release, write or publish release notes, update announcement cards, update the `supaterm.com` changelog, or run `make bump-and-release`. Always draft the changelog and confirm the announcement-card decision before editing `apps/supaterm.com`, creating GitHub release notes, or running the release command.
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

3. Decide whether the release needs an announcement card.

Before changelog approval, ask the human whether the release needs an in-app announcement card.

Record exactly one decision:
- no announcement card needed, with reason
- announcement card needed, with confirmed UI copy and target version
- announcement card deferred, with explicit human confirmation

If a card is needed, do not continue the release until the app task is implemented or explicitly deferred by the human.

4. Draft the changelog and stop.

Write a proposed changelog entry in the same shape used by `apps/supaterm.com/src/lib/changelog-data.ts`, but do not edit files yet. Keep the draft tight and user-facing.

The draft must include:
- version
- date in `YYYY-MM-DD`
- title prefixed with an emoji that represents the release
- optional description
- sections with `new`, `improvements`, and `fixes` only when needed

Do not include internal CI, refactors, or maintenance unless they materially affect users.

After drafting, show the exact text to the human and wait for approval. If the human changes wording, revise the draft and ask again. Do not proceed until the changelog text is explicitly confirmed.

5. Apply the confirmed changelog.

After approval, add the new entry at the top of `apps/supaterm.com/src/lib/changelog-data.ts`. Reuse the confirmed wording verbatim except for formatting needed by the file.

6. Validate the website change.

Run:

```bash
make web-check
make web-test
```

If either fails, fix the issue before continuing.

7. Commit only the changelog change.

Stage only the website changelog file. Use a signed commit. Do not use `git add .`.

8. Run the release command only after the changelog commit is ready.

Run:

```bash
make bump-and-release
```

Choose `regular` for the first yearly release or a normal release, and `hotfix` for patch-only follow-ups.

This command computes the next CalVer version, updates `apps/Configurations/Versions.xcconfig`, creates the bump commit, pushes the branch, creates the annotated tag, and pushes the tag. Never run it before changelog approval because it publishes immediately.

9. Sync the GitHub release notes.

`make bump-and-release` creates the tag, but the GitHub release notes may still be blank. Use the confirmed changelog text as the single source of truth.

Run one of:

```bash
gh release edit v26.0.0 --title "v26.0.0" --notes-file <notes-file>
gh release create v26.0.0 --draft --verify-tag --title "v26.0.0" --notes-file <notes-file>
```

Prefer `gh release edit` when the draft already exists.

10. Report the outcome.

Return:
- the changelog file path
- the changelog commit sha
- the bump commit sha
- the tag
- the release URL
- any workflow run URL still in progress
- the announcement-card decision

## Guardrails

- Do not edit the changelog before the human confirms the wording.
- Do not run `make bump-and-release` before the human confirms the wording.
- Do not run `make bump-and-release` without an explicit announcement-card decision.
- Do not invent release-note content that is not grounded in the diff.
- Do not touch unrelated dirty files.
- Do not use the browser for GitHub work; use `gh`.
- Keep the website entry and GitHub release notes aligned.
- Every changelog title must start with an emoji that represents the release.
