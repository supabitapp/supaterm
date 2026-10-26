# Install Supaterm

Supaterm runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch Supaterm and configure providers afterwards.

## From source

Use Node.js 24 and the Mise-managed project tools. Get the source from
[supabitapp/supaterm](https://github.com/supabitapp/supaterm), install Mise using the
[development runbook](../operations/development.md#first-checkout),
and run these commands from the repository root:

```bash
export PATH="$HOME/.local/bin:$PATH"
mise install
mise exec -- vp i
mise exec -- vp run dev
```

Open the pairing URL printed by the dev runner to connect the web app.
See [development](../operations/development.md) for desktop and mobile builds.

On Windows, in PowerShell, install the packaged command line with:

```powershell
irm https://supaterm.com/install.ps1 | iex
```

This installs the `supaterm` binary to `~/.local/bin`. If your shell reports
`command not found` afterwards, add that directory to `PATH`. Set
`SUPATERM_CHANNEL=nightly` to install the nightly train, or `SUPATERM_VERSION` to pin an exact
version.

### Intel Macs

The pre-commit hook tool is not available for Intel macOS. Install the project tools and run the
server without installing hooks:

```bash
export PATH="$HOME/.local/bin:$PATH"
mise install
mise exec -- vp i
mise exec -- vp run dev
```

## Command line

If you have a packaged `supaterm` executable installed, these commands are available:

| Task                                             | Command                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Start the server and open the web app            | `supaterm`                                                                    |
| Start the server without a browser               | `supaterm serve`                                                              |
| Keep it running in the background (macOS, Linux) | `supaterm service install` ([details](./background-service.md))               |
| Move to the newest release                       | `supaterm update`                                                             |
| Reclaim database space                           | `supaterm doctor` ([details](./background-service.md#reclaim-database-space)) |
| Remove it again                                  | `supaterm uninstall`                                                          |
| List supported server settings                   | `supaterm settings list`                                                      |

Run `supaterm --help` for the full reference.

## Desktop app

Build the desktop client from this repository. Distribution artifacts belong to
Supaterm's [GitHub Releases](https://github.com/supabitapp/supaterm/releases).

On macOS, download the installer from [supaterm.com/download](https://supaterm.com/download),
open it, and double-click **Install Supaterm**. It downloads the latest stable release for your
Mac's chip, installs it in Applications, and opens it. If your account cannot write to
Applications, it installs in the Applications folder in your home folder instead. If Supaterm is
already open, the installer asks you to quit it first. To install with Homebrew instead, run
`brew install supaterm`. Nightly builds and the full disk images for Apple Silicon and Intel are on
the releases page.

### The `supaterm` command

The desktop app installs its bundled `supaterm` command on startup when possible.
It preserves an existing `supaterm` command from a separate installation. On macOS
and Linux it creates a link in a writable command folder; on Windows it adds the
app's command folder to your `PATH`. Open a new terminal afterwards. If the command
folder is not on your `PATH`, add it to run `supaterm` by name.

**Settings → About → supaterm command** lets you retry installation or
remove the command. **Remove** also disables automatic installation until you
choose **Install** again. The bundled command follows desktop app updates.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Sharing & access** to run agents and projects
there. Install the provider CLIs inside that distro. Supaterm installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
supaterm app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `supaterm app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

## Mobile app

On iPhone and iPad, [join the Supaterm beta on TestFlight](https://testflight.apple.com/join/VUJkRPwq).
The link and a QR code are also in **Settings → About → Mobile app** on web and desktop.
On Android, build the client using the [mobile development guide](../../apps/mobile/README.md).
The phone connects to a server on another machine. Follow
[remote access](./remote-access.md) to pair it with a pairing URL or QR code.

If the app crashes during launch, open Settings → Diagnostics on the next launch
that succeeds. It lists startup crashes from the last 7 days with the error and
component stack that store crash reports leave out. Copy the report and paste it
into a GitHub issue. Error messages can quote values from the app, so read it over
before sharing.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity | Install and sign in with Google from Supaterm's provider settings.                                                                                        |
| Pi          | Install [Pi](./providers-pi.md#set-up-pi) with Node.js 22.19 or newer, then run `pi` and `/login`.                                                        |
| Muse Code   | Install [Muse Code](https://dev.meta.ai/docs/muse-code) on the server, run `muse login`, then enable it in Settings → Providers.                          |

Provider CLIs must be on the server's `PATH`. If Supaterm cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Codex connected through ChatGPT and Antigravity can use their
managed runtimes without a `PATH` entry.

Supaterm warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or the
CLI's own update command when Supaterm cannot tell. Update a CLI installed with
mise through mise. Cursor and Antigravity update with Supaterm. Homebrew installs
compare against the version Homebrew offers, which can trail the npm release by
a few hours.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, Supaterm does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), [Pi](./providers-pi.md), and
[Muse Code](./providers-muse.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating Supaterm](./updating.md): update the app and connected servers.
