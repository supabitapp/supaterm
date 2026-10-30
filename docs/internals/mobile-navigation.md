# Mobile navigation

Home and thread routes share the [root native stack](../../apps/mobile/src/Stack.tsx)
so UIKit can animate the header within one navigation controller. The iPad sidebar
has its own stack. Splitting Home and threads between controllers loses that
continuous transition.

A new thread's draft is the same `Thread` route with `draft` params, not a
separate sheet. [ThreadScreenHost](../../apps/mobile/src/features/threads/ThreadScreenHost.tsx)
keeps one detail screen mounted while the route moves between a draft and its
thread, and sending the first message swaps the params in place
([`submittedThreadParams`](../../apps/mobile/src/features/threads/thread-route-state.ts)).
Pushing or replacing the route on submit, or publishing an empty loading screen
while a draft resolves its project, flashes between two surfaces.

## UIKit constraints

The [Screens dependency](../operations/mobile-screens-fork.md)
preserves behavior that is easy to break when changing native headers:

- The brand belongs in `headerTitle`. On iOS 26.5, UIKit morphs a background-free
  leading toolbar item's rectangle into the next screen's glass back button,
  even when the items have different identifiers.
- UIKit's scroll-edge fade does not recognize Fabric text views. An empty native
  label supplies the custom title's geometry. Removing that apparently unused
  view changes the fade.
- Leading, trailing, and center item groups need independent caches. A button can
  belong to only one group; rebuilding an unchanged group can pull its buttons
  out of a group UIKit is still animating. Cache ownership also includes the
  header config, whose event emitter changes on remount.
- A horizontal ScrollView at its leading edge must yield to the full-screen back
  gesture. Upstream gives every horizontal ScrollView priority, so swiping back
  on a code block or table can only bounce its content.

Native header props require code generation and a new binary.
Patch rebuild guidance lives in the
[mobile development README](../../apps/mobile/README.md#development).

## Native media presentations

iOS delegates full-screen video to [AVKit](../../apps/mobile/modules/supaterm-native-controls/ios/SupatermNativeVideoPresentation.swift)
and images and documents to [Quick Look](../../apps/mobile/modules/supaterm-native-controls/ios/SupatermNativeFilePresentation.swift).
Each framework owns its controls and transition. A separate UIKit zoom transition
prevents AVKit's native Close action from exiting full screen and interferes with
Quick Look's interactive return to its thumbnail. The AVKit entry selector is
guarded, with standard modal presentation as the fallback.

[Thumbnail registration](../../apps/mobile/modules/supaterm-native-controls/ios/SupatermNativePresentation.swift)
holds weak view references for transition and share-sheet anchors. It does not own
the preview; a source row can disappear while a native presentation is open.
Identifiers must distinguish attachments that are visible at the same time.
Native promises complete after dismissal so callers keep local file leases until
the preview or share flow has finished.

Treat a dismissal request as pending until UIKit finishes its current transition.
Starting another dismissal while presentation or an interactive dismissal is
settling can strand the controller. Video cleanup restores the previous audio
configuration only if it still matches the preview's configuration. It must not
deactivate the shared audio session, which may belong to another player or recorder.

Video playback holds the first signed asset URL for the lifetime of the preview.
Following credential refreshes reactively would restart playback. Quick Look copies
original bytes into its own temporary directory so preview and sharing cannot
mutate a draft or workspace file.

## Selecting workspace detail

Selecting a thread, draft, or workspace destination replaces the selected detail. Deliberate
navigation within that detail pushes a route. Preserve this distinction across search, deep
links, new-project completion, and inspector expansion. Persist selection identity, never a
navigator's transient route key.

The native feed marker registers its descendant scroll view for header behavior. Scroll-edge
bleed can extend behind the Duo's vertical bar, but must never change horizontal content insets
or offsets. Restore clipping and geometry when detached or recycled. Hidden inspectors release
their stream consumers, and compact layouts retain normal back navigation.
