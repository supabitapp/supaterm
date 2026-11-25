# Secrets

Supaterm can read credentials from a secret provider, so the credential stays in your password
manager and Supaterm saves only a reference to it. Agents can also ask you for a secret in a
private card instead of in the chat.

## Secret providers

1Password is the supported provider. Supaterm reads secrets with the
[1Password CLI](https://developer.1password.com/docs/cli/) (`op`), so `op` must be installed and
signed in on the machine that runs the Supaterm server. When you use Supaterm on another machine or
from your phone, that is the remote machine, not the device in front of you.

A desktop sign-in asks for approval on that machine, which a remote user cannot answer. On a remote
or headless server, sign `op` in with a [service account](./secrets-1password-service-account.md) or a
[Connect server](./secrets-1password-connect.md) instead.

To add one, open **Settings → Secrets**, select **Add provider**, and enter a name and the
1Password account: the shorthand, sign-in address (without `https://`), or ID that
`op account list` shows. Secret providers belong to the environment you are connected to. Each
environment keeps its own list.

## Use a secret reference

Credential fields in Settings, such as provider environment variables and credentials, source
control tokens, and device host tokens, show a source picker next to the field once the environment
has a secret provider. Pick **Value** to save the credential itself, or pick a secret provider and
enter a reference such as `op://vault/item/field`. Copy the reference from 1Password with **Copy
Secret Reference**. Select the check button next to a reference to read it now. If it reads,
providers that use it start using the new value.

Supaterm reads the secret when it needs it, for example when a provider starts. Change the
credential in 1Password and refresh to use the new value.

## When a secret cannot be read

If 1Password is locked or signed out, the provider or feature that needs the secret shows an error
naming the secret provider. Unlock 1Password on the server's machine, then select **Refresh** in
**Settings → Providers**. Supaterm never replaces a saved credential it cannot read with another
login.

## Remove a secret provider

When you remove a secret provider in **Settings → Secrets**, Supaterm lists the fields that read
from it. Removing it clears those fields, so set them again before you need them. The secrets in
1Password are not touched.

## When an agent asks for a secret

An agent that needs a token or password shows a secret request card in the thread instead of asking
you to paste it into the chat. Type or paste the value and select **Send**, or select **Decline**.
You can answer from web, desktop, or mobile.

If the environment has a secret provider, a card that asks for one value also lets you pick the
provider and enter a reference instead of the value. Answering with a reference needs permission to
manage providers, as saving a reference in Settings does; a session without it sees only the value
field. Supaterm reads the secret once, when you answer. If 1Password is locked, the card says so and
the request stays open: unlock it and try again, or enter the value.

The value never appears in the conversation. It goes into a private file that the agent's commands
can read for about 24 hours.

When the agent needs several values at once, such as an email and a password, one card asks for all
of them. Fields that are not secret, like an email, show what you type.

A card waits for up to an hour. After that it shows as expired and the agent carries on without the
value. Tell the agent to ask again when you are ready.
