# Licensing

## Offer

- A device license costs $99 USD once.
- The purchase grants perpetual use on one device and 365 days of updates.
- A further 365 days of updates costs $59 USD per device.
- Billing does not renew automatically.
- Prices do not change with purchase quantity.
- Support is not part of the license or update entitlement.

The license never expires. Its update entitlement expires.

## Owners and Devices

- One owner may hold any number of device licenses.
- Each device license has its own update entitlement.
- A device license may activate one device at a time.
- The owner may move a license by deactivating it on the old device, then activating it on the new device.
- If the old device is unavailable, the owner must email license@supaterm.com to request a transfer.
- Transferring one device license does not affect the owner's other device licenses.

## Free Mode

Supaterm runs without a license in free mode. Free mode permits up to five open tabs across all spaces and windows on the device.

Supaterm never deletes or closes saved tabs to enforce this limit. When free mode restores more than five existing tabs, the user may use them but may not create another tab until fewer than five remain open.

An active device license removes the tab limit.

## Updates

A new device license receives an update entitlement ending 365 days after purchase.

- A renewal made before the current entitlement ends adds 365 days to its end date.
- A renewal made after the current entitlement ends starts a new 365-day period on the renewal date.
- A release is owned forever when its release date falls on or before the device license's update entitlement end date.
- The updater offers licensed users only releases their device license owns.
- An owned release keeps paid mode after its update entitlement ends.

When an expired update entitlement is used with a newer release, Supaterm runs in free mode and offers two actions: renew the entitlement or download the newest owned release.

## Offline Use and Revocation

An activated, owned release keeps paid mode without an internet connection. Failed license checks never remove paid access from an activated device.

This means revocation cannot be strict. After a transfer, refund, or chargeback, an old device may retain paid mode while it remains offline. Supaterm applies the revocation when that device next reaches the licensing service.

## Refunds

The owner may request a refund within seven days of purchase. A refund revokes the affected device license without changing the owner's other device licenses.

A full renewal refund voids that renewal period. The entitlement fold recomputes the update end date, and releases after the new end date become unowned. If a later kept renewal spans the same dates, those dates remain owned because the entitlement stores one end date rather than separate ranges.

## Systems

- Cloudflare hosts the licensing service, its data, and its user-facing management surfaces.
- Stripe handles purchases, renewals, and refunds.

## Sales Launch

Purchase, renewal, and the free-mode tab limit stay off by default in the app. Purchase and renewal also stay off by default on the website, owner portal, and licensing service.
The app and website release workflows read the `LICENSE_SALES_ENABLED` repository variable. The
licensing service has its own `LICENSE_SALES_ENABLED` Worker binding. Enable all three only after
the live payment, webhook, refund, email, and tax checks pass. Activation and entitlement refresh
remain available while sales are off.
