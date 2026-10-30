# Frequently asked questions

## Where do my agents run?

Agents run on the machine hosting the selected environment. A phone or remote browser controls
that work without moving its files or provider credentials. Keep the host awake and reachable.
See [remote access](./remote-access.md).

## Why is a provider missing or signed out?

Install and sign in to the provider on the host, then refresh **Settings → Providers**. A login
on the device viewing Supaterm does not sign in the remote host. See [provider setup](./install.md#providers).

## Does Supaterm replace my provider subscription?

Supaterm uses the provider accounts configured on each environment. Usage estimates describe
recorded model usage, not a subscription bill. See [Usage and limits](./usage.md).

## How do I clean up finished work?

Mark the thread **Done** to clear active work without deleting its history. Manage worktree
cleanup in [project settings](./project-settings.md). Review files before deleting a worktree.

## Why can I view an environment but not change it?

Your paired session may have read-only or limited permissions. Pair again with the required
permissions from the host. See [manage or revoke access](./remote-access.md#manage-or-revoke-access).

## Where should I start when something fails?

Check the selected environment and provider status first. Use **Send feedback** for a problem
you can reproduce in the app, or `supaterm triage` on the host when the app cannot open.
See [working with threads](./thread-sidebar.md#send-feedback).
