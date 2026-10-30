# fx

Install [fx](https://fx.sh) and run `fx login` on the machine hosting your Supaterm environment.
Enable it in **Settings → Providers**, then refresh provider status. Set **Binary path** when
`fx` is outside that machine's `PATH`. Instances on one machine share its fx login.

Choose **Default** to use the model reported by fx on that host, or select an available model
explicitly. The picker also exposes fx's effort setting. To change fx's backend, run
`fx provider` on the host. Type `$` in the composer to select a skill that fx discovers.

fx offers **Supervised** and **Auto** permission modes. Other saved modes run as Supervised.
Changing mode reconnects the same session. Plan mode and background text generation for titles
or commits are unavailable; select another provider for those tasks.

Subagents appear under their parent thread with the task and final reply. fx does not forward
their individual steps or permission requests. Stop a waiting subagent when it cannot proceed.
See [provider setup](./install.md#providers) and [permission modes](./permission-modes.md).
