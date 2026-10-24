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

## Recordings that outlive the controller

A recording must survive going offline, a failed upload, and leaving the
draft. The controller can hand a clip off instead of deleting it:
`takeRecording()` stops capture without transcribing, and a transcriber that
throws `deferred` has adopted the clip. Either way the URI leaves the controller's
deletion set, and a handed-off URI is never collected again even while the
recorder still reports it. The web composer keeps adopted clips as
[pending clips](../../apps/web/src/dictation/pendingClips.ts) in IndexedDB. A clip
transcribed later is inserted only when the draft's owner, text and revision are
unchanged since capture; otherwise it waits for an explicit insert. Clips
recovered after a reload always wait.

## Queued voice messages

"Transcribe and send" queues an outbox turn that still carries the audio. The
transcript's position travels through the normal send path as a private-use
[slot character](../../packages/client-runtime/src/voice-input/voiceSlot.ts), so
prompt formatting cannot shift it. Before delivery, the outbox prepares such an
entry: it transcribes without holding the message lock, then commits the spliced
text under the lock only if the entry's revision is unchanged, so Cancel and Move
to composer stay available and a late result from another tab is dropped. Only
then does delivery start. Entries with audio are stored as schema version 3,
which older builds refuse to load, so they can never send the typed text
without its transcript.
