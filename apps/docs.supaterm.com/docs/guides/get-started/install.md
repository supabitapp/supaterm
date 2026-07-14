---
title: Install Supaterm
description: Install Supaterm on macOS with Homebrew or the signed disk image.
---

Supaterm requires macOS Tahoe or newer.

## Homebrew

```bash
brew install supaterm
```

Open Supaterm from Applications after the installation completes.

## Disk image

1. [Download the latest Supaterm disk image](https://supaterm.com/download/latest/supaterm.dmg).
2. Open the disk image and move Supaterm to Applications.
3. Launch Supaterm.

Supaterm includes its matching `sp` CLI. Every terminal started inside the app receives the bundled CLI on `PATH`, so no separate CLI installation is needed.

## Verify the installation

Open a Supaterm terminal and run:

```bash
sp diagnostic
```

A healthy result identifies the running app and reports a reachable socket. Continue with [first launch](/guides/get-started/first-launch).
