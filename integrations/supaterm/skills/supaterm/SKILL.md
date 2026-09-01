---
name: supaterm
description: Control Supaterm spaces, tab groups, tabs, panes, licensing, coding-agent integrations, and task launches with `sp`. Use when an agent needs to inspect or operate Supaterm, organize tabs, handle a tab-limit refusal, guide a Supaterm purchase or activation, open commands in tabs or panes, or launch and prompt coding agents.
---

# Supaterm

This file is a stable discovery stub. `sp skills` commands are served by the running Supaterm app, so the guide always matches the version you are driving. Load it before running Supaterm commands:

```bash
sp skills get core
```

Load the complete command references when needed:

```bash
sp skills get core --full
```

Resolve the bundled directory when reading one reference directly:

```bash
sp skills path core
```

Load the license reference before guiding a purchase, activation, renewal, deactivation, or `license_required` tab refusal:

```bash
sp skills path core
```

Read `references/license.md` from the printed directory.

Load the coding-agent workflow before launching or prompting a coding agent:

```bash
sp skills get coding-agents
```

List every guide the running app offers:

```bash
sp skills list
```
