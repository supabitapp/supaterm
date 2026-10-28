# Voice input

Transcription edits a composer draft. Audio is temporary client input. When the
user chooses to transcribe and send, the mobile composer waits for a successful
draft insertion before invoking normal message submission with its current guards.
Navigation cancels that send intent without discarding the transcript. Clients
transcribe locally on supported iOS devices. No client uses environment-backed
transcription yet, but the server supports it.

The server's [`Transcription`](../../apps/server/src/transcription/Transcription.ts)
service transcribes an uploaded recording with the login of the provider instance the
request names. It never falls back to another account. Clients upload a 16 kHz mono 16-bit
WAV through the pending-attachment upload, because the server never transcodes. The upload
id is the idempotency key, and the work belongs to the service, so a dropped connection
stops only the wait. Resubmitting after a reconnect joins the running work or returns the
recorded outcome. Only a deliberate user action, such as trying again or switching source,
should send `retry: true`, because a retry spends the account again.

The [shared controller](../../packages/client-runtime/src/voice-input/controller.ts)
owns the operation while the client supplies capture and transcription. Preparation
binds the transcriber and resolved locale for the whole recording. Draft ownership,
text, and revision are captured before recording and checked before insertion, so
a late transcript cannot overwrite a draft that was edited or replaced.

Cancellation invalidates a result immediately, but resources stay owned until the
underlying work settles. Apple's native transcription call cannot be interrupted
once started. Releasing the session or deleting its recording when the abort signal
fires would race that work. The [transcription contract](../../packages/client-runtime/src/voice-input/transcription.ts)
therefore requires implementations to settle only after their work has stopped;
the [Apple binding](../../apps/mobile/src/native/voiceTranscription.ios.ts) checks
cancellation between native calls and discards late results.
