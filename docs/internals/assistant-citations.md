# Assistant citations

Citations carry the selected excerpt and source identity in ordinary message text.
Drafts, clipboard copies, stashes, and sent messages keep that representation
without a separate citation store. The saved quote remains usable when its source
disappears or changes. The [shared format](../../packages/shared/src/assistantCitations.ts) uses
stable environment IDs without a browser origin, so moving between local, remote,
and tunnel connections does not change a citation's identity.

Source navigation is best effort. [Text selectors](../../apps/web/src/lib/assistantTextSelection.ts)
refer to rendered text after whitespace normalization, measured in UTF-16 units.
They cannot be applied to raw Markdown. The original excerpt keeps its whitespace;
normalization is only for locating it. Repeated text needs an unambiguous context
match, even if one occurrence still sits at the saved offsets. Guessing could
highlight the wrong claim.

Mobile's renderer reports only the selected text and its offset inside one native
text block. A [mobile citation](../../apps/mobile/src/lib/assistantAnnotation.ts)
therefore carries block offsets and no context, and web locates it only when the
quote is unique in the message. Keep that fallback when changing the matcher.

Navigation owns the highlight's lifetime across virtual-row remounts. The source
row must be fetched, unfolded, mounted, and measured before quote positioning
takes over from normal timeline scrolling. Remounting must not revive a dismissed
highlight. The [navigation hash](../../apps/web/src/lib/assistantCitationNavigation.ts)
uses base64url because router normalization otherwise decodes whitespace and
source IDs inside the citation URI.

An HTML render is cited by its turn item ID in the message slot, which history paging already
resolves, so the wire shape is unchanged. The host cannot read a selection inside the sandboxed
page. On web the page's [bootstrap](../../packages/shared/src/htmlRender.ts) reports a settled
selection, and the host accepts it only from the focused frame, as plain text capped at the
citation limit. The bootstrap is written into the page at publish, so a render published before
the bridge existed never reports. Mobile needs no page script: the WebView's selection menu
carries the action through a [library patch](../../patches/react-native-webview@14.0.1.patch),
which adds custom items to the platform menu where upstream replaces it. Navigation reveals the
render's row and stops there, because nothing outside the frame can find or highlight its text.

Expand citations with the [shared formatter](../../packages/shared/src/assistantCitations.ts)
before dispatch to a provider adapter. Send the saved excerpt without looking up
the source, distinguish quoted reference material from the user's comment, and
leave persisted messages in their original form. Input limits apply after
expansion as well as before it. A draft that fits as encoded links can exceed the
provider limit once expanded.
