# Voice input

Transcription edits a composer draft, or becomes a queued message. Audio is temporary
client input. Clients record 16 kHz mono 16-bit PCM, because the server never transcodes;
the browser resamples in an AudioWorklet as it records.

The wait after Stop is the provider finishing what it hasn't heard yet, so a clip sent only
once recorded waits longer the longer it is. When the server advertises
`transcriptionStreams`, the client streams each 100 ms frame while recording, through
`transcription.prepareStream` and a WebSocket on its own route, kept off the RPC socket. The
server feeds the provider's streaming endpoint as frames arrive. The stream only carries audio:
the dictation is a live entry in `TranscriptionUploads` under a client-minted id, and the
upload with that id finishes it. An empty body collects the transcript once the stream said
`finished`. The WAV fills in the frames a broken stream missed, because the stream and the
WAV hold the same bytes. A voice message is queued under the dictation's id, so delivery
joins the live entry and sends its text. Before any audio reaches the provider, a refusal or
a full instance forgets the dictation, and the upload transcribes fresh. After that, a
provider failure, or a client that stays away past the reconnect grace, is the dictation's
failure. Recovering it would spend the account again, which takes a deliberate retry.

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

The [shared controller](../../packages/client-runtime/src/voice-input/controller.ts)
owns the operation while the client supplies capture and transcription. Preparation
binds the transcriber and resolved locale for the whole recording. Draft ownership,
text, and revision are captured before recording and checked before insertion, so
a late transcript cannot overwrite a draft that was edited or replaced.

Cancellation invalidates a result immediately, but resources stay owned until the
underlying work settles. Deleting the recording when the abort signal fires would race an
upload that is still reading it. The [transcription contract](../../packages/client-runtime/src/voice-input/transcription.ts)
therefore requires implementations to settle only after their work has stopped.
