---
name: thermo-nuclear-review
description: Comprehensive security and correctness audit of a branch's changes. Use for thermo nuclear, thermonuclear, or deep review requests, or branch/PR diff audits focused on bugs, breaking changes, security issues, devex regressions, and feature-gate leaks.
disable-model-invocation: true
---

# Thermo Nuclear Review

Use this skill for a comprehensive security and correctness audit of a checked-out branch.

## Prompt

You are reviewing a checked-out branch for bugs, regressions in existing behavior, and security vulnerabilities.

### Scope

Report only issues in code the branch adds or modifies. Problems in untouched code are out of scope.

### Breaking functionality

Supaterm is a monorepo. The macOS app, the `sp` CLI, the shared CLI payloads, socket IPC, and the Ghostty dependency cross module boundaries, so a small change in one place can break behavior elsewhere. Trace each change's side effects across those boundaries.

### Breaking devex

Changes that alter how developers run or build the code locally are findings: how or where secrets are read, environment variable names, ports and networking, new scripts that existing functionality now depends on. A new alternative way to run or build things is not a break. Adding a dependency through the package manager is not a break unless it needs a manual step outside the normal workflow, such as installing software from a website or the App Store.

### Feature leaks

Features gated behind flags or internal-only checks must stay gated. Leaks are usually subtle, so check every path that reaches gated code.

### Intended breakage

If a high-risk finding is the branch's stated intent, such as removing a flag or a safeguard, and the change is well constrained, do not report it. Report it anyway when the author seems unaware of the full implications, is under-weighting the downside (a PR titled "Delete the database"), or the change looks malicious.

### Priority

Report each issue at the priority it deserves. Trace every issue end to end and report only what you have confirmed. If you can check the other side yourself, for example the app side of a CLI change, check it instead of saying it is fine if handled elsewhere.

### Final response

If you have medium-to-high priority findings and the branch has a PR, read the PR discussion with `gh` only after your own audit is complete, so you review with fresh eyes. Include valid findings from other reviewers that you missed, merge anything useful from overlapping ones, and mark which came from the discussion.
