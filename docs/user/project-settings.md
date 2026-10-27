# Settings and project overrides

On web and desktop, the "Applying settings for …" sentence at the top of Settings pages picks
the project and environment a change applies to. Pages that only hold device preferences, such as
Appearance, don't show it. They start at **All projects** and **All environments**
and stay selected as you move between categories or search for a setting.

Preferences saved on this device, such as appearance, confirmations and browser profiles, always
show and ignore the selection. Everything else is stored on a server. Choose one environment to
edit its settings, or leave **All environments** to edit every connected environment at once.
Offline environments keep their current values; this is a bulk edit, not a synced global default.

Choose a project to override settings for it on the selected environments. A layers icon beside
each server row's title shows where the value comes from: the built-in default, the environment,
or a project override. Click it to see that chain on every selected environment. An override can
be reset to inherit again. Settings that cannot be overridden by a project are shown read-only
while a project is selected.

When the selected environments disagree, the control shows **Mixed** in place of a value and the
layers icon turns amber. Picking a value applies it to every selected environment.

Changing an environment value never touches a project's own override. When projects override the
setting you are editing, the layers icon counts them and the chain lists each one with its value:
click a project to jump to it, or **Reset all** to make those projects follow the environment
again.

Providers and diagnostics are per machine: they show one environment at a time, the primary
one until you pick another. Every other setting fans out to the selection.

With a project selected, a provider's switch in **Settings → Providers** turns it on or off for
that project only, in either direction: a provider off on the machine can be used in one project,
and one on everywhere can be kept out of another. That project's model pickers follow the switch,
and no new turn there can start on a provider it turned off, including queued messages and
follow-ups from delegated tasks. A turn already running when the switch flips finishes. A delegated
task's result still lands in its parent thread, which sees it on its next turn. Reset returns the project to the
machine's setting. Every other provider setting stays per machine.

On mobile, open **Settings** and use the filter in its header to choose connected environments
and a project. The filter stays available in server-setting pages. With **All projects** selected,
the **Server settings** categories and automatic completion controls in **Thread behavior** edit the
selected environments' defaults. Choosing a project edits its overrides on the selected
environments. Use **Use defaults** in a page to remove that page's project overrides.
Open **Settings → Projects & threads → Overview** to rename the project across its selected
connected checkouts and see where those checkouts live.
Settings that are environment-wide stay read-only while a project is selected. When selected
targets disagree, a control shows **Mixed** until you choose one value. Appearance, keyboard,
and other phone-only settings ignore the filter.

## Worktree branch names

In **Settings → Source Control → Worktree branch naming**, choose a static prefix,
the repository name as a prefix, a model-selected semantic prefix such as `feat/` or `fix/`,
or custom instructions for the complete name. The static prefix defaults to `supaterm/`; a
trailing slash is optional, and an empty prefix adds nothing. Invalid characters in a static
prefix are replaced with hyphens. The repository name prefix is lowercase, as in
`my-app/add-search`. A fork uses its own repository's name rather than the upstream's, and
a project without a remote uses its folder name. Custom instructions are appended to the
naming prompt and can specify issue IDs, namespaces, and casing.

These settings apply to automatically named new worktree branches. Select a project
to override its environment defaults. Worktree directories keep their original names.
If generation fails, or a custom name is invalid or already taken, the temporary
branch name remains.

## Scheduled tasks on mobile

Open **Settings → Scheduled tasks** to create recurring tasks or manage existing
ones across your connected environments. Use the settings filter to narrow the
list by environment or project. Each task runs on the environment you choose,
using its project, model, and workspace settings. Fixed-time schedules use that
environment's time zone, which may differ from your phone's.

Deleting a thread also deletes tasks that post into that thread. Tasks that start
a new thread on each run survive deletion of their previous threads.

You can edit, pause, resume, run immediately, or delete a task from the list.
Leaving an edited form asks before discarding unsaved changes.

## Defaults and inheritance

General contains the model and workspace for new threads. Integrations controls agent browser
access. Source Control contains automatic pull, the default pull request merge method and text
generation. The same rows edit environment defaults or project overrides depending on the
project crumb.

The Project category holds the project's name, icon, actions, checkouts and removal. Open it and
choose a project to manage. Actions belong to a project: editing them creates the project's own list
on each selected environment, and reset returns to the environment's shared list. A project's
`supaterm.json` actions can be imported there.

Settings a repository can also declare in `supaterm.json`, such as the workspace for new threads,
resolve in one order: a project override, then the environment setting, then `supaterm.json`, then the
built-in default. Leave a setting on **Inherit** to let the next tier decide.
Browser access changes apply when an agent session next starts.

New worktrees initialize git submodules recursively. If that step is slow because the repository
declares many nested submodules, set **Submodules** in **Settings → General** (with the project
selected to override it there) to **Top level only** to stop at the ones the repository declares
itself, or **Skip** to leave them for a setup script. It resolves in the same order as the
workspace default: a `"worktreeSubmodules"` value in the `supaterm.json` of the branch being checked out
applies when the project and environment are both on **Inherit**.

## Worktree location

New worktrees go in the `worktrees` folder of the Supaterm home directory. To put them somewhere else,
such as another drive, set **Settings → Storage → Worktree location** to an absolute path like
`D:\worktrees` or `~/worktrees`. The setting is per machine. Existing worktrees stay where they
are, and cleanup covers both the default folder and the custom one.

## Storage cleanup

Open **Settings → Storage** to configure automatic cleanup on one machine or all connected
environments. Cleanup rules for merged, unchanged, and deleted-thread worktrees are on by default;
inactive-worktree and done-worktree cleanup remain disabled until you choose an age. Policies run on the server at
startup, when changed, and hourly. Offline machines keep their existing policies.

Select a project to set **Automatic worktree cleanup** to **Inherit**, **Off**, or **Custom**.
Inherit follows each machine's rules; Off keeps that project's worktrees until you remove them
manually. Custom applies separate worktree rules to the selected project or checkout. Browser
captures and log retention remain machine-wide.

Worktrees can be removed after a chosen number of inactive days, a chosen number of days after
their thread is marked done, after merging, or when they have no commits beyond the default
branch. Set **Delete done worktrees** to 0 days to remove a worktree at the next cleanup after its
thread is marked done. A thread marked done automatically counts its done days from its last
activity, not from when it was marked done. Only Supaterm-managed worktrees are eligible. Active
sessions prevent removal, and so do other threads sharing the worktree, except a thread's own
subagents: their shared worktree is removed once the parent qualifies and every subagent is idle.
**Keep worktrees with local changes** defaults
to **Uncommitted changes**, which protects tracked edits and untracked files but deletes ignored
files such as `.env` and build output. **Any local files** also protects ignored files other than
`node_modules`. **Edited tracked files** protects only tracked edits and allows untracked and
ignored files to be deleted. Branches and thread history stay; starting another turn recreates the checkout.
Merge cleanup requires a merged pull request whose commits are included in the remote default
branch. A squash or rebase merge on GitHub also counts when the pull request targeted the default
branch and the worktree is still at the pull request's last commit.

**Delete worktrees with deleted threads** removes safe worktrees after their last thread is
deleted, including archived threads and worktrees left by earlier deletions. The server waits for
sessions and terminals to stop and retries skipped worktrees after restart. Turn this policy off to
keep those worktrees and retain the existing prompts for deleting one manually.

Choose **Delete now**, then click again to confirm, to run the enabled rules immediately. The
latest results show which worktrees were removed or kept and why, plus any failures.
Results also list folders in the worktree folder that no thread uses, with their sizes; cleanup never removes them, so remove them manually if you want.

Browser captures and rotated logs have separate retention periods. Expired capture links stop
working. Current logs, message attachments, and browser profiles are kept.

## Project icons

Select the project and open Project to choose an icon, emoji, monogram, or image. The choice applies to
every checkout in the project group and appears on connected clients. Choose **Automatic** to let
Supaterm detect an icon again.

Choose **Monogram** in the icon picker to set one or two letters or numbers and a color.

A project whose saved icon is no longer offered shows a folder in its color until you pick another
icon.

When no image is found, web and desktop show a two-character monogram derived from the saved
project name. For example, `Nebula` becomes `NA`, `Silver Orchard` becomes `SO`, and `M7 Forge`
becomes `M7`. Each project keeps its own color as you add projects; colors repeat only after nine
projects. To pick a different color, choose **Monogram** in the icon picker.

## Keep the default branch current

**Automatically pull** is enabled by default to keep the default-branch checkout up to date
with its configured upstream. In Source Control, choose an environment to change the default or a
project to override it.
On mobile, use **Settings → Source control** to change selected environment defaults or project overrides.

Supaterm only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.
