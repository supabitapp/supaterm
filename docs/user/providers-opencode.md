# OpenCode

Install OpenCode 2 on the machine running your environment, for example with
`npm install -g @opencode/cli`. Authenticate it, then enable it in
**Settings > Providers**. See [provider setup](./install.md#providers). Supaterm
supports OpenCode 2.0.18 and newer, including when you connect an existing OpenCode
server.

Plan mode uses OpenCode's `plan` agent.

## Move from OpenCode 1.x

Supaterm no longer runs OpenCode 1.x. When it finds a 1.x install or server, the
provider reports that 1.x is no longer supported, and OpenCode threads cannot run
until you move to OpenCode 2.

OpenCode 2 is a separate package, `@opencode/cli`. Both packages install a command
named `opencode`, so npm refuses to install one over the other. Remove the old
package with `npm uninstall -g opencode-ai`, run `npm install -g @opencode/cli`, then
refresh provider status. Supaterm offers no update for a 1.x install, because it
never moves one to 2.x for you. If Supaterm still finds 1.x afterwards, set
**Binary path** in provider settings to the OpenCode 2 executable.

OpenCode 2 converts the shared OpenCode database to its own format the first time it
runs. Don't run OpenCode 1.x and 2.x side by side on the same machine. Threads you
started on 1.x continue on 2.x.

## Compaction

OpenCode compacts long conversations itself, and Supaterm has no setting for it.
Change it under `compaction` in an OpenCode configuration file, such as
`opencode.json`: `auto` turns automatic compaction on or off, `buffer` sets the token
headroom, and `keep.tokens` sets how much recent context stays. Send `/compact` to
compact a thread yourself.

## Local or external server

Leave **Server URL** empty to let Supaterm start OpenCode locally. Supaterm secures
that server with its own password, so **Server password** applies only to an
external server.

To use an existing OpenCode server, set **Server URL** and its password in provider
settings. Supaterm uses only that configured password for an external server; it
does not read one from the environment. If connection or version checks fail, check
the URL, credentials, and OpenCode version, then refresh provider status.

After a lost connection, send another prompt to reconnect to the same OpenCode
session.

## Approvals

OpenCode follows the shared [permission modes](./permission-modes.md). **Auto** has
the same rules as **Supervised** because OpenCode has no AI approval reviewer.

Allowing a request for the session also allows matching requests for the rest of
that OpenCode session. It does not carry over to other threads. Declining an action
does not stop the whole turn.

## Refresh models, commands, and skills

After changing an OpenCode login or configuration, use **Refresh provider status**
in **Settings > Providers** for that environment. On mobile, use **Refresh models**
in the thread settings. Reconnecting also refreshes the catalog. Periodic health
checks refresh it only while the provider has not come up healthy.

Native OpenCode configuration can remain cached while the local OpenCode server is
running. Supaterm stops that server after 30 seconds without use, and a thread with
an open OpenCode session counts as use. Refresh again once it has stopped to reload
the files. An external server may need its own reload or restart before Supaterm can
see configuration changes.

Existing threads keep their selected model and options even when it disappears
from the catalog. If OpenCode rejects that model, select an available one and retry.
