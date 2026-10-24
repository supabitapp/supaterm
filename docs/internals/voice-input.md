# Voice input

Transcription edits a composer draft. Audio is temporary client input. Clients
record and an environment transcribes: the clip goes up as a pending attachment
and one `dictation.transcribe` call names the source, so no audio crosses the
WebSocket. The server deletes the upload once read.

Two settings pick where audio goes, and neither follows the thread's provider.
Each environment's `dictation.source` names one account, and the server
transcribes with exactly that source or fails; it never substitutes another
account or vendor, because that would send the user's audio somewhere they did not
choose. Which environment transcribes is a per-device choice resolved by
[`resolveDictationRoute`](../../packages/client-runtime/src/state/dictation.ts):
on the desktop app, Automatic prefers the bundled local server so audio stays on
the user's machine and uses their own logins, even for a thread on a remote
environment. The client inserts the returned text into the draft, so no work
moves between environments. The route is fixed when recording starts and stored
with saved recordings and queued voice messages; a failure never reroutes it.

The server runs each transcription in a fiber owned by the dictation service and
keyed by the client's recording id, not by the RPC. A phone that backgrounds or a
relay that drops mid-call asks again with the same id and joins the running call
or gets the kept transcript instead of paying for a second vendor call. Failures
are not kept, so a retry with a fresh upload starts over.

Claude's speech endpoint only takes 16 kHz mono PCM, and environments ship no
audio decoder. Clients therefore produce what the chosen source lists in
`audioFormats`: web converts a compressed recording to WAV with
`OfflineAudioContext` only when needed, iOS records PCM directly, and Android uses
a native PCM recorder because Expo's Android recorder cannot produce PCM.

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

## Saved recordings

Server transcription always saves the recording before anything is uploaded:
the transcriber stores it and returns `saved`, which moves the audio out of the
controller, and the
[saved-recordings runner](../../packages/client-runtime/src/voice-input/savedRecordings.ts)
transcribes it from storage. A closed tab, a suspended phone, or a dropped
connection therefore never loses audio, and offline is just a recording waiting
for its environment. Storage writes happen before state changes are shown; when
storage refuses a recording it stays in memory, marked unsaved, rather than being
deleted. Web keeps recordings in IndexedDB and mobile in the app's documents
directory, behind the same storage interface.

Each recording has an owner. A finished transcript goes to the owner's consumer:
a composer inserts it only when the draft's owner, text and revision are
unchanged since capture, otherwise it waits for an explicit Insert, and
recordings restored after a reload always wait. The on-device Apple route still
transcribes inside the controller.

## Queued voice messages

"Transcribe and send" saves the recording under the queued message's owner and
queues the message with a reference to it. The outbox does not deliver a message
that still references a recording. When the transcript arrives, the outbox
appends it to the message through its revision-checked edit, which also makes the
message deliverable. Cancelling the message discards the recording, and Move to
composer hands the recording back to the composer. Entries that reference a
recording are stored as schema version 3, which older builds refuse to load, so
they never send the typed text without its transcript.

On mobile, Transcribe and send queues nothing. A memory-only send intent keyed by
the recording id makes the composer send once its consumer commits the transcript
into an unchanged draft; leaving the screen, changing owner, cancelling, or
backgrounding drops it, so a recording restored after a relaunch never sends.
