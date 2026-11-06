# Voice input

Transcription edits a composer draft, or becomes a queued message. Audio is temporary
client input. Clients record 16 kHz mono 16-bit PCM, because the server never transcodes;
the browser resamples in an AudioWorklet as it records.

The wait after Stop is the provider finishing what it hasn't heard yet, so audio streams to
the environment while it is recorded (`transcription.prepareStream`) on its own WebSocket,
kept off the RPC socket. That stream only carries audio. The dictation is a live entry in
`TranscriptionUploads` under a client-minted id, and the upload with that id collects the
outcome: an empty body once the stream answered `finished`, or the WAV, whose bytes match the
stream's, to fill in what a broken stream missed. A voice message is queued under the same id
so delivery joins the transcript instead of paying for another. Before any audio reaches the
provider, a refusal forgets the dictation and the upload transcribes it fresh. After that, a
lost stream or provider failure fails the dictation, because recovering would spend the
account again.

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
request names, or the environment's `transcriptionProviderInstanceId` setting. A named
instance that can't transcribe is refused, never substituted. Only an unset setting picks,
through `automaticTranscriptionProvider`, which the clients share so their microphone state
matches the server's choice. A repeated upload keeps its first pick or is refused as a
conflict, so a redelivery never moves to another account. App clients upload through
[`TranscriptionUploads`](../../apps/server/src/transcription/TranscriptionUploads.ts); agents
and `supaterm transcribe` use the pending-attachment upload. The upload id is the
idempotency key, and the work belongs to the service, so a dropped connection stops only the
wait. Resubmitting after a reconnect joins the running work or returns the
recorded outcome. Only a deliberate user action, such as trying again or switching source,
should send `retry: true`, because a retry spends the account again.

The dictionary runs in `Transcription` on the text a backend returns, so
review, voice messages, agents, and the CLI get the same transcript.

The [shared controller](../../packages/client-runtime/src/voice-input/controller.ts)
owns the operation while the client supplies capture and transcription. Preparation
binds the transcriber and resolved locale for the whole recording. Draft ownership,
text, and revision are captured before recording and checked before insertion, so
a late transcript cannot overwrite a draft that was edited or replaced.

Cancellation invalidates a result immediately, but resources stay owned until the
underlying work settles. Deleting the recording when the abort signal fires would race an
upload that is still reading it. The [transcription contract](../../packages/client-runtime/src/voice-input/transcription.ts)
therefore requires implementations to settle only after their work has stopped.
