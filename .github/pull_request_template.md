<!--
Read CONTRIBUTING.md before opening a PR. Review capacity is limited, and meeting
the requirements does not guarantee review or merging. Solve one underlying problem.
The same requirements apply to drafts. Draft status does not defer triage or closure.
Use a conventional commit title in plain language, such as "fix(web): new threads no longer spike CPU".
-->

## Problem

<!-- Explain the problem in a sentence or two. Include expected behavior and
reproduction steps or environment where relevant. -->

## Change

<!-- Explain how this fixes the problem. If it spans components or clients,
explain why those changes are needed for the same fix. Split independent fixes. -->

## Scope and approval

<!-- Link the triaged bug issue or the discussion with explicit maintainer approval
of direction and scope, including the approval comment. For a very small, focused
fix of an obvious bug, explain why it qualifies without a prior issue or discussion.
For focused configuration of an established capability, explain what already exists,
what the option controls, and why its effects stay within that capability. Adding a
setting alone is not a new feature or an approval exemption; broader workflow or
behavior changes still need approval. Scope and verification requirements still apply.
There is no line-count or file-count cutoff. -->

## Verification

<!-- Describe the focused tests or manual checks you ran and the observed results
for the changed behavior. State anything you could not check. "Tests pass" alone
is insufficient; broad repo-wide checks are not required.

For UI changes, include clear before/after screenshots. Include a short recording
when motion, timing, transitions, or interaction details are needed to demonstrate
the change. Preserve native screenshot dimensions: do not capture a collage through a
browser preview, since it may be downsampled. Merge before/after source images into one
asset, placed horizontally with before on the left and after on the right, and compose
it directly from the source images. Before attaching, check the pixel
dimensions with `file` or `sips` and confirm that text is legible at GitHub's rendered
width. Upload evidence to GitHub using `gh pr create --attach`. Never commit PR-only
assets. -->

<!-- If you used an agent, end with the model and harness that did the work. -->
