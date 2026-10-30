# Mobile Screens dependency

The mobile client pins a committed `react-native-screens` archive in
[its package manifest](../../apps/mobile/package.json). The archive's `supacode-fork.json`
records its source provenance and local adaptations. Read that record before replacing it;
Supaterm's native navigation changes must survive a source update.

Repack JavaScript, declarations, and native source together. Update provenance for any adapted
files, then update the package reference and lockfile with the resulting archive. Do not claim
byte-identical upstream source when the package contains local changes.

Compiled JavaScript, declarations and native source must come from the same
revision. Replacing only one part can leave the navigation API out of step with
its native implementation. Keep source provenance with each replacement archive
and update the dependency and lockfile together.

The fingerprint includes native dependency files and applied native patches.
A change to either requires a matching native client before the new bundle can
run. See [native client verification](../../.agents/skills/test-supaterm-mobile/SKILL.md).

The same iOS binary supports iPhone, iPad, and Duo. UIKit hinge updates enable
phone workspace columns at runtime; regular phones retain portrait rotation.
Duo support requires a binary built with the iOS 27.1 SDK, so every iOS EAS
profile pins the `macos-tahoe-26.6-xcode-27.1` image; an OTA cannot add the
native APIs.

## Search field observer workaround

UIKit's search field token counter leaves a main-queue
`NSTextStorageDidProcessEditing` observer behind after the field is freed. When
JS later measures text in a new storage at the same address, its thread and the
main thread deadlock, most often during a Duo fold. Since `5.0.0-t3.34`,
`+[RNSSearchBar initialize]` replaces
`-[NSNotificationCenter addObserverForName:object:queue:usingBlock:]` for the
whole process, recognises that private UIKit observer, and removes it with its
search field.

This is a workaround, not a fix: the swizzle is process-wide with no device or
iOS version gate, and depends on a private UIKit block shape. Remove it once
UIKit stops leaking the observer, or replace it with a narrower fix in the
Screens fork. When changing it, check ordinary iPhone and iPad searches,
repeated sheet and search dismissal, Duo folding, and that unrelated
`addObserverForName:` callers still receive notifications.
