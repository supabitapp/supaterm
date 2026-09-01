# License commands

Inspect the current mode:

```bash
sp license
sp license status --json
```

The status reports free, paid, or updates-ended mode, the update entitlement end day when present, this Mac's name, and the free-mode tab count.

Open the purchase page:

```bash
sp license buy
```

Supaterm opens the page in the user's default browser and prints the URL. The user completes payment there. The license key appears on the thank-you page and arrives by email.

Activate through the hidden prompt:

```bash
sp license activate
```

The user must run this command and paste the key. Never ask the user to put a key in a command argument, chat, prompt, file, environment variable, or agent transcript. Never read the clipboard, email, browser, shell history, or files to find a key.

Refresh or deactivate:

```bash
sp license refresh
sp license deactivate
```

Deactivation needs a network connection and frees the license for another Mac.

Open renewal:

```bash
sp license renew
```

## Purchase playbook

1. Run `sp license`.
2. If `sp tab new` returns `license_required`, explain the five-tab free limit. Do not retry the refused command.
3. Run `sp license buy` only after the user asks to buy or agrees to proceed.
4. Tell the user to finish payment in the browser.
5. Tell the user to run `sp license activate` and paste the key into its hidden prompt.
6. Run `sp license` to confirm the mode.
7. Retry the original tab command only after status reports paid.

The agent never enters payment details, completes checkout, handles the key, or searches for the key.
