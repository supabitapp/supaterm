# Voice input

Transcription edits a composer draft, or becomes a queued message. Audio is temporary
client input. Clients record a 16 kHz mono 16-bit WAV, because the server never
transcodes; the browser records in its own codec and converts when recording stops.

Stopping for review uploads the recording without `submit` and inserts the returned text
through the [shared controller](../../packages/client-runtime/src/voice-input/controller.ts).
Sending a recording that would be the whole message hands it to the thread outbox instead
(`controller.send()`), so it survives going offline or a reload and keeps its place among
typed messages. On delivery the outbox prepares the upload with `submit`, and the server
transcribes and dispatches it as the user's `message.dispatch`. The command id doubles as
the upload id, so a repeated delivery joins the server's work instead of paying for another
transcription. The outbox prepares only when it delivers, because an upload URL lives ten
minutes and dies with the server process. Retrying a failed voice message re-enqueues it
under a new command id: a transcription failure dispatched nothing, and the server keeps the
failed outcome for the old id. When the draft holds anything else, the client transcribes
first and sends through the normal send path, because a submitted upload carries only text.

The server's [`Transcription`](../../apps/server/src/transcription/Transcription.ts)
service transcribes an uploaded recording with the login of the provider instance the
request names, or the environment's `transcriptionProviderInstanceId` setting. It never
falls back to another account. App clients upload through
[`TranscriptionUploads`](../../apps/server/src/transcription/TranscriptionUploads.ts); agents
and `supaterm transcribe` use the pending-attachment upload. The upload id is the
idempotency key, and the work belongs to the service, so a dropped connection stops only the
wait. Resubmitting after a reconnect joins the running work or returns the
recorded outcome. Only a deliberate user action, such as trying again or switching source,
should send `retry: true`, because a retry spends the account again.

The [shared controller](../../packages/client-runtime/src/voice-input/controller.ts)
owns the operation while the client supplies capture and transcription. Preparation
binds the transcriber and resolved locale for the whole recording. Draft ownership,
text, and revision are captured before recording and checked before insertion, so
a late transcript cannot overwrite a draft that was edited or replaced.

Cancellation invalidates a result immediately, but resources stay owned until the
underlying work settles. Deleting the recording when the abort signal fires would race an
upload that is still reading it. The [transcription contract](../../packages/client-runtime/src/voice-input/transcription.ts)
therefore requires implementations to settle only after their work has stopped.
