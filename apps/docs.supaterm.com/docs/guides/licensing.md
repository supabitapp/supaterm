---
title: Licensing
description: Activate Supaterm, move a device license, and understand free mode and update ownership.
---

Supaterm works without a license. License sales and the five-tab free-mode limit are not active yet.

After sales open, free mode will allow five open tabs across all spaces and windows. Panes will not count toward the limit. Supaterm will not close restored tabs above the limit, but it will require you to close tabs before creating another.

## Activate a license

Open **Settings → License**, enter the key from your purchase email, then select **Activate**. One device license can stay active on one Mac at a time.

You can also activate from a Supaterm pane:

```bash
sp license activate
```

The command reads the key through a hidden prompt. Use `sp license status` to check the current mode and update end date.

## Move to another Mac

Deactivate the old Mac before activating the new one:

```bash
sp license deactivate
```

You can also select **Deactivate This Mac** in License settings. Deactivation needs a network connection because it frees the device slot on the licensing service.

If the old Mac is unavailable, email [license@supaterm.com](mailto:license@supaterm.com) with the purchase email and the device name shown by the activation error.

## Updates and renewals

A new license includes perpetual use on one device and 365 days of updates. A release remains yours when its release date falls on or before your update end date.

When a newer release falls outside that period, you can keep using your current version. The app refreshes your entitlement automatically after renewal. You can also run:

```bash
sp license refresh
```

**Get Your Owned Release** downloads the newest stable release included in the license.

## Offline use and refunds

An activated, owned release keeps licensed mode while offline. Failed checks do not remove paid access.

A purchase refund requested within seven days revokes that device license. A full renewal refund removes that renewal period and can shorten the update end date. Refunds, payment disputes, and support transfers take effect when the app next reaches the licensing service.
