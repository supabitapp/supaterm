# Mobile Screens dependency

The mobile client pins `react-native-screens` to the committed
`apps/mobile/deps/react-native-screens-5.0.0-supacode.61.tgz` archive. Its runtime,
declarations and native sources come from
[source commit c213f92b](https://github.com/pingdotgg/react-native-screens/commit/c213f92b5c0f73280b93603f541d5589dc4b9bc4),
based on `72f38a66c188bdebee7a7798c9b72a121b7a8451`. Supaterm changes the package
version and archive metadata; it preserves the runtime and native source.
`supacode-fork.json` inside the archive records that provenance.

To repack a new upstream revision, extract its archive, set `version` in
`package.json` to the matching `5.0.0-supacode.N`, replace `t3-fork.json` with a
`supacode-fork.json` that keeps the original metadata under `source`, swap that
file name in the `files` list, and run `npm pack --ignore-scripts`. Every other
file must stay byte-identical to the source archive.

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

## Enriched Markdown dependency

`apps/mobile/deps/react-native-enriched-markdown-1.2.0-supacode.20.tgz` is upstream's
`1.2.0-t3.18` archive from
[source commit 16db4c75](https://github.com/pingdotgg/enriched-markdown/commit/16db4c75c7ba892178e26a5e84b28773e35daa8d),
based on `1d00a92abc3f7cf953946cf42f999523dec699dc`. Repack a new revision as
`1.2.0-supacode.N` the same way as Screens.

Unlike Screens, the fork applies a pnpm patch on top of the archive:
`patches/react-native-enriched-markdown@1.2.0-supacode.N.patch` makes code blocks
start wrapped, and the header toggle unwraps them. Rebase it with every repack. Drop
hunks the new archive already carries, even ones `git apply` still accepts with fuzz,
and rename the patch and both `pnpm-workspace.yaml` keys (`allowBuilds` and
`patchedDependencies`) with the archive. `vp i` fails when a hunk no longer applies.
Upstream's `.pnpmfile.cjs` rejects any patch on an archive dependency, so the fork
leaves that guard out.
