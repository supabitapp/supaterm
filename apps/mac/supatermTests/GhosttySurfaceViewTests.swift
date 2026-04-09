import AppKit
import Testing

@testable import supaterm

struct GhosttySurfaceViewTests {
  @Test
  func legacyScrollerFlashRequiresLegacyStyleAndMotionAllowance() {
    #expect(
      GhosttySurfaceScrollView.shouldFlashLegacyScrollers(
        scrollerStyle: .legacy,
        reduceMotion: false
      )
    )
    #expect(
      !GhosttySurfaceScrollView.shouldFlashLegacyScrollers(
        scrollerStyle: .overlay,
        reduceMotion: false
      )
    )
    #expect(
      !GhosttySurfaceScrollView.shouldFlashLegacyScrollers(
        scrollerStyle: .legacy,
        reduceMotion: true
      )
    )
    #expect(
      !GhosttySurfaceScrollView.shouldFlashLegacyScrollers(
        scrollerStyle: .overlay,
        reduceMotion: true
      )
    )
  }

  @Test
  func bypassesKeyEquivalentHandlingForFieldEditor() {
    let fieldEditor = NSTextView()
    fieldEditor.isFieldEditor = true

    #expect(
      GhosttySurfaceView.shouldBypassKeyEquivalentHandling(
        firstResponder: fieldEditor
      )
    )
  }

  @Test
  func keepsKeyEquivalentHandlingForNonFieldEditorResponder() {
    #expect(
      !GhosttySurfaceView.shouldBypassKeyEquivalentHandling(
        firstResponder: NSView(frame: .zero)
      )
    )
    #expect(
      !GhosttySurfaceView.shouldBypassKeyEquivalentHandling(
        firstResponder: NSTextView()
      )
    )
    #expect(
      !GhosttySurfaceView.shouldBypassKeyEquivalentHandling(
        firstResponder: nil
      )
    )
  }
}
