# Voice input

Transcription edits a composer draft. Audio is temporary client input. iOS
transcribes on the device. Web and desktop record compressed audio and ask the
draft's environment to transcribe it: the clip goes up as a pending attachment
and one `dictation.transcribe` call names the source, so no audio crosses the
WebSocket. The server re-resolves the source and deletes the upload once read.

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

A web recording must survive going offline, a failed upload, and leaving the
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
