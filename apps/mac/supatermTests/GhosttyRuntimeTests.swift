import AppKit
import Carbon.HIToolbox
import Darwin
import Foundation
import GhosttyKit
import SupatermSupport
import SwiftUI
import Synchronization
import Testing
import UniformTypeIdentifiers

@testable import supaterm

@MainActor
struct GhosttyRuntimeTests {
  @Test
  func runtimeUsesInitialEffectiveAppearance() throws {
    let cases: [(NSAppearance.Name, ColorScheme)] = [
      (.aqua, .light),
      (.darkAqua, .dark),
    ]
    for (appearanceName, expectedColorScheme) in cases {
      let source = EffectiveAppearanceSource(
        initialAppearance: try #require(NSAppearance(named: appearanceName))
      )
      let runtime = try makeGhosttyRuntime(
        "",
        effectiveAppearanceObserver: source.observe
      )

      #expect(runtime.colorSchemeForTesting() == expectedColorScheme)
    }
  }

  @Test
  func runtimeTracksEffectiveAppearanceChanges() throws {
    let lightAppearance = try #require(NSAppearance(named: .aqua))
    let darkAppearance = try #require(NSAppearance(named: .darkAqua))
    let source = EffectiveAppearanceSource(initialAppearance: lightAppearance)
    let runtime = try makeGhosttyRuntime(
      "",
      effectiveAppearanceObserver: source.observe
    )

    #expect(runtime.colorSchemeForTesting() == .light)

    source.send(darkAppearance)

    #expect(runtime.colorSchemeForTesting() == .dark)

    source.send(lightAppearance)

    #expect(runtime.colorSchemeForTesting() == .light)
  }

  @Test
  func runtimeStopsObservingEffectiveAppearanceOnDeinit() throws {
    let appearance = try #require(NSAppearance(named: .aqua))
    let source = EffectiveAppearanceSource(initialAppearance: appearance)
    var runtime: GhosttyRuntime? = try makeGhosttyRuntime(
      "",
      effectiveAppearanceObserver: source.observe
    )

    #expect(source.isObserved)

    runtime = nil

    #expect(runtime == nil)
    #expect(!source.isObserved)
  }

  @Test
  func keyboardShortcutsNormalizeUnicodeKeyEquivalents() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = super+L=new_window
      keybind = super+Ä=new_tab
      """
    )

    let latinShortcut = try #require(runtime.keyboardShortcut(forAction: "new_window"))
    #expect(latinShortcut.key == "l")
    #expect(latinShortcut.modifiers == [.command])
    #expect(runtime.shortcut(forAction: "new_window")?.physicalKeyCode == nil)

    let nonASCIIShortcut = try #require(runtime.keyboardShortcut(forAction: "new_tab"))
    #expect(nonASCIIShortcut.key == "ä")
    #expect(nonASCIIShortcut.modifiers == [.command])
    #expect(runtime.shortcut(forAction: "new_tab")?.physicalKeyCode == nil)
  }

  @Test
  func printablePhysicalShortcutUsesCurrentKeyboardLayout() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = super+backquote=new_window
      """
    )
    let expected = try #require(
      SupatermKeyboardLayout.character(
        for: UInt16(kVK_ANSI_Grave),
        modifiers: .command
      )
    )

    let shortcut = try #require(runtime.shortcut(forAction: "new_window"))

    #expect(shortcut.keyboardShortcut.key == KeyEquivalent(expected))
    #expect(shortcut.keyboardShortcut.modifiers == .command)
    #expect(shortcut.physicalKeyCode == UInt16(kVK_ANSI_Grave))
  }

  @Test
  func keyboardShortcutsDistinguishForwardDeleteFromBackspace() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = delete=new_window
      keybind = backspace=new_tab
      """
    )

    let forwardDelete = try #require(runtime.keyboardShortcut(forAction: "new_window"))
    #expect(forwardDelete.key == .deleteForward)

    let backspace = try #require(runtime.keyboardShortcut(forAction: "new_tab"))
    #expect(backspace.key == .delete)
  }

  @Test
  func runtimeCreatedWhileApplicationIsInactiveRejectsNonGlobalBinding() throws {
    let app = NSApplication.shared
    let previousDelegate = app.delegate
    let delegate = GhosttyAppActionPerformerSpy()
    app.delegate = delegate
    defer {
      app.delegate = previousDelegate
    }

    let runtime = try makeGhosttyRuntime(
      """
      keybind = super+shift+0=toggle_visibility
      """,
      applicationIsActive: { false }
    )
    let event = try GhosttyGlobalKeyEvent(
      #require(
        NSEvent.keyEvent(
          with: .keyDown,
          location: .zero,
          modifierFlags: [.command, .shift],
          timestamp: 0,
          windowNumber: 0,
          context: nil,
          characters: ")",
          charactersIgnoringModifiers: "0",
          isARepeat: false,
          keyCode: UInt16(kVK_ANSI_0)
        )
      )
    )

    #expect(!runtime.handleGlobalKeyEvent(event))
    #expect(delegate.toggleVisibilityCount == 0)
  }

  @Test
  func opinionatedStringContentsReturnsStringBeforeImageData() throws {
    let pasteboard = makePasteboard()
    pasteboard.declareTypes([.string, .supatermPNGImage], owner: nil)
    pasteboard.setString("echo hello", forType: .string)
    pasteboard.setData(try makeImageData(.png), forType: .supatermPNGImage)

    #expect(pasteboard.getOpinionatedStringContents() == "echo hello")
  }

  @Test
  func opinionatedStringContentsPreservesMixedItemOrder() throws {
    let pasteboard = makePasteboard()
    let first = NSPasteboardItem()
    first.setString("first", forType: .string)
    let fileURL = URL(fileURLWithPath: "/tmp/second file") as NSURL
    let last = NSPasteboardItem()
    last.setString("last", forType: .string)
    pasteboard.writeObjects([first, fileURL, last])

    #expect(
      pasteboard.getOpinionatedStringContents()
        == "first /tmp/second\\ file last"
    )
  }

  @Test
  func writeImageToTempFileWritesPNGData() throws {
    let pasteboard = makePasteboard()
    pasteboard.declareTypes([.supatermPNGImage], owner: nil)
    pasteboard.setData(try makeImageData(.png), forType: .supatermPNGImage)

    let path = try unescapedPath(pasteboard.writeImageToTempFile())
    defer { try? FileManager.default.removeItem(atPath: path) }

    #expect(path.contains("/supaterm-pasted-images/pasted-"))
    #expect(path.hasSuffix(".png"))
    #expect(FileManager.default.fileExists(atPath: path))
  }

  @Test
  func writeImageToTempFileConvertsTIFFDataToPNG() throws {
    let pasteboard = makePasteboard()
    pasteboard.declareTypes([.supatermTIFFImage], owner: nil)
    pasteboard.setData(try makeImageData(.tiff), forType: .supatermTIFFImage)

    let path = try unescapedPath(pasteboard.writeImageToTempFile())
    defer { try? FileManager.default.removeItem(atPath: path) }

    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    #expect(Array(data.prefix(8)) == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  }

  @Test
  func clipboardContentCopiesBinaryDataByLength() throws {
    var source: [UInt8] = [0x41, 0x00, 0x42, 0xFF]
    let copied = "application/octet-stream".withCString { mime in
      source.withUnsafeMutableBytes { bytes in
        GhosttyClipboardContent(
          copying: ghostty_clipboard_content_s(
            mime: mime,
            data: bytes.baseAddress?.assumingMemoryBound(to: CChar.self),
            len: bytes.count,
            payload_id: 0
          )
        )
      }
    }
    source = Array(repeating: 0, count: source.count)

    let content = try #require(copied)
    #expect(content.mime == "application/octet-stream")
    #expect(content.data == Data([0x41, 0x00, 0x42, 0xFF]))
  }

  @Test
  func clipboardContentAliasesShareCopiedPayloadStorage() throws {
    let mimes = ["text/plain", "text/plain;charset=utf-8"]
    let mimePointers = try mimes.map { try #require(strdup($0)) }
    defer {
      for pointer in mimePointers {
        free(pointer)
      }
    }
    let expected = Data((0..<4_096).map { UInt8(truncatingIfNeeded: $0) })
    let source = UnsafeMutableRawPointer.allocate(byteCount: expected.count, alignment: 1)
    let aliasSource = UnsafeMutableRawPointer.allocate(byteCount: expected.count, alignment: 1)
    defer {
      source.deallocate()
      aliasSource.deallocate()
    }
    expected.copyBytes(to: source.assumingMemoryBound(to: UInt8.self), count: expected.count)
    expected.copyBytes(to: aliasSource.assumingMemoryBound(to: UInt8.self), count: expected.count)
    let contents = [
      ghostty_clipboard_content_s(
        mime: mimePointers[0],
        data: source.assumingMemoryBound(to: CChar.self),
        len: expected.count,
        payload_id: 7
      ),
      ghostty_clipboard_content_s(
        mime: mimePointers[1],
        data: aliasSource.assumingMemoryBound(to: CChar.self),
        len: expected.count,
        payload_id: 7
      ),
    ]

    var copyCount = 0
    let copied = try #require(
      contents.withUnsafeBufferPointer { contents in
        GhosttyClipboardContent.copying(contents) { pointer, count in
          copyCount += 1
          return Data(bytes: pointer, count: count)
        }
      })
    source.initializeMemory(as: UInt8.self, repeating: 0, count: expected.count)
    aliasSource.initializeMemory(as: UInt8.self, repeating: 0, count: expected.count)

    #expect(copyCount == 1)
    #expect(copied.map(\.mime) == mimes)
    #expect(copied.map(\.data) == [expected, expected])
  }

  @Test
  func kittyWriteConfirmationCapsItsTotalPromptCopy() throws {
    let first = Data(repeating: 0x41, count: 12_000)
    let second = Data(repeating: 0x42, count: 12_000)
    let payload = try #require(
      makeClipboardConfirmationPayload(
        contents: [
          (mime: "text/plain", data: first),
          (mime: "application/octet-stream", data: second),
        ],
        request: GHOSTTY_CLIPBOARD_REQUEST_KITTY_WRITE
      )
    )

    #expect(
      payload.contents.reduce(0) { $0 + $1.data.count }
        == GhosttyClipboardDisplay.maximumPromptCopyBytes
    )
    #expect(payload.contents.map(\.originalByteCount) == [first.count, second.count])
  }

  @Test
  func pasteConfirmationKeepsItsFullExactSnapshot() throws {
    let first = Data(repeating: 0x41, count: 12_000)
    let second = Data(repeating: 0x42, count: 12_000)
    let payload = try #require(
      makeClipboardConfirmationPayload(
        contents: [
          (mime: "text/plain", data: first),
          (mime: "application/octet-stream", data: second),
        ],
        request: GHOSTTY_CLIPBOARD_REQUEST_PASTE
      )
    )

    #expect(payload.contents.map(\.data) == [first, second])
  }

  @Test
  func clipboardReadsBinaryRepresentationWithoutCStringTruncation() {
    let pasteboard = makePasteboard()
    let type = NSPasteboard.PasteboardType("application/octet-stream")
    let data = Data([0x41, 0x00, 0x42, 0xFF])
    pasteboard.declareTypes([type], owner: nil)
    pasteboard.setData(data, forType: type)

    #expect(
      pasteboard.ghosttyData(
        forMime: "application/octet-stream",
        request: GHOSTTY_CLIPBOARD_REQUEST_KITTY_READ
      ) == data
    )
  }

  @Test
  func clipboardReadsRawAndNativePlainTextRepresentations() {
    let representations = [
      (NSPasteboard.PasteboardType("text/plain"), Data("raw".utf8)),
      (NSPasteboard.PasteboardType(UTType.plainText.identifier), Data("native".utf8)),
    ]

    for (type, data) in representations {
      let pasteboard = makePasteboard()
      pasteboard.declareTypes([type], owner: nil)
      pasteboard.setData(data, forType: type)

      #expect(
        pasteboard.ghosttyData(
          forMime: "text/plain",
          request: GHOSTTY_CLIPBOARD_REQUEST_KITTY_READ
        ) == data
      )
    }
  }

  @Test
  func clipboardURIListWriteCanBeListedAndReadBack() {
    let pasteboard = makePasteboard()
    let data = Data("file:///tmp/first\r\nfile:///tmp/second\r\n".utf8)

    #expect(
      GhosttyPasteboard.write(
        [GhosttyClipboardContent(mime: "text/uri-list", data: data)],
        to: pasteboard
      )
    )
    #expect(pasteboard.ghosttyAvailableMimes() == ["text/uri-list"])
    #expect(
      pasteboard.ghosttyData(
        forMime: "text/uri-list",
        request: GHOSTTY_CLIPBOARD_REQUEST_KITTY_READ
      ) == data
    )
  }

  @Test
  func clipboardReadsCopiedFilesAsURIList() throws {
    let pasteboard = makePasteboard()
    let first = URL(fileURLWithPath: "/tmp/first file") as NSURL
    let second = URL(fileURLWithPath: "/tmp/second") as NSURL
    pasteboard.writeObjects([first, second])

    let data = try #require(
      pasteboard.ghosttyData(
        forMime: "text/uri-list",
        request: GHOSTTY_CLIPBOARD_REQUEST_KITTY_READ
      )
    )
    #expect(
      String(bytes: data, encoding: .utf8)
        == "file:///tmp/first%20file\r\nfile:///tmp/second\r\n"
    )
  }

  @Test
  func clipboardListsOnlyDeclaredImageRepresentationsWithoutLoadingData() {
    let pasteboard = makePasteboard()
    let item = NSPasteboardItem()
    let provider = PasteboardDataProviderSpy()
    item.setDataProvider(provider, forTypes: [.supatermPNGImage])
    pasteboard.writeObjects([item])

    let mimes = pasteboard.ghosttyAvailableMimes()

    #expect(mimes == ["image/png"])
    #expect(Set(mimes).count == mimes.count)
    #expect(provider.requestedTypes.isEmpty)
  }

  @Test
  func programmaticImageReadsDoNotSynthesizePlainTextOrLoadImageData() {
    let pasteboard = makePasteboard()
    let item = NSPasteboardItem()
    let provider = PasteboardDataProviderSpy()
    item.setDataProvider(provider, forTypes: [.supatermPNGImage])
    pasteboard.writeObjects([item])

    #expect(
      pasteboard.ghosttyData(
        forMime: "text/plain",
        request: GHOSTTY_CLIPBOARD_REQUEST_OSC_52_READ
      ) == nil
    )
    #expect(
      pasteboard.ghosttyData(
        forMime: "text/plain",
        request: GHOSTTY_CLIPBOARD_REQUEST_KITTY_READ
      ) == nil
    )
    #expect(provider.requestedTypes.isEmpty)
  }

  @Test
  func clipboardListsPublicDataAsOctetStreamWithoutLoadingData() {
    let pasteboard = makePasteboard()
    let item = NSPasteboardItem()
    let provider = PasteboardDataProviderSpy()
    let type = NSPasteboard.PasteboardType(UTType.data.identifier)
    item.setDataProvider(provider, forTypes: [type])
    pasteboard.writeObjects([item])

    #expect(pasteboard.ghosttyAvailableMimes() == ["application/octet-stream"])
    #expect(provider.requestedTypes.isEmpty)
  }

  @Test
  func clipboardListsFileURLsWithoutSynthesizedPlainText() {
    let pasteboard = makePasteboard()
    pasteboard.writeObjects([URL(fileURLWithPath: "/tmp/clipboard-file") as NSURL])

    let mimes = pasteboard.ghosttyAvailableMimes()

    #expect(mimes.contains("text/uri-list"))
    #expect(!mimes.contains("text/plain"))
  }

  @Test
  func clipboardWriteProvidesAliasDataLazily() throws {
    let pasteboard = makePasteboard()
    let mimes = (0..<64).map { "application/x-supaterm-alias-\($0)" }
    let data = Data([0x41, 0x00, 0x42, 0xFF])
    let contents = mimes.map { GhosttyClipboardContent(mime: $0, data: data) }
    let dataByType = Dictionary(
      uniqueKeysWithValues: mimes.map {
        (NSPasteboard.PasteboardType(mimeType: $0), data)
      }
    )
    let provider = PasteboardDataProviderSpy(dataByType: dataByType)

    #expect(
      GhosttyPasteboard.write(
        contents,
        to: pasteboard,
        dataProvider: provider
      )
    )
    #expect(provider.requestedTypes.isEmpty)
    #expect(Set(pasteboard.ghosttyAvailableMimes()) == Set(mimes))
    #expect(provider.requestedTypes.isEmpty)

    let requestedMIME = try #require(mimes.last)
    #expect(
      pasteboard.ghosttyData(
        forMime: requestedMIME,
        request: GHOSTTY_CLIPBOARD_REQUEST_KITTY_READ
      ) == data
    )
    #expect(provider.requestedTypes == [NSPasteboard.PasteboardType(mimeType: requestedMIME)])
  }

  @Test
  func clipboardWriteProviderPreservesBinaryData() {
    let pasteboard = makePasteboard()
    let mime = "application/x-supaterm-binary"
    let data = Data([0x41, 0x00, 0x42, 0xFF])

    #expect(
      GhosttyPasteboard.write(
        [GhosttyClipboardContent(mime: mime, data: data)],
        to: pasteboard
      )
    )
    #expect(
      pasteboard.ghosttyData(
        forMime: mime,
        request: GHOSTTY_CLIPBOARD_REQUEST_KITTY_READ
      ) == data
    )
  }

  @Test
  func clipboardWriteReplacesExistingContents() {
    let pasteboard = makePasteboard()
    pasteboard.setString("stale", forType: .string)

    #expect(
      GhosttyPasteboard.write(
        [GhosttyClipboardContent(mime: "text/plain", data: Data("current".utf8))],
        to: pasteboard
      )
    )
    #expect(pasteboard.string(forType: .string) == "current")
  }

  @Test
  func clipboardTextAliasesUseOneNativeStringRepresentation() {
    let aliases = ["text/plain", "text/plain;charset=utf-8", "UTF8_STRING", "TEXT", "STRING"]
    let expected = GhosttyClipboardContent(mime: "text/plain", data: Data("safe".utf8))
    let contents =
      [expected]
      + aliases.dropFirst().map {
        GhosttyClipboardContent(mime: $0, data: Data("different".utf8))
      }

    #expect(
      aliases.allSatisfy {
        NSPasteboard.PasteboardType(mimeType: $0) == .string
      }
    )

    #expect(GhosttyPasteboard.normalizedContents(contents) == [expected])
  }

  @Test
  func primaryClipboardIsUnsupported() {
    #expect(NSPasteboard.ghostty(GHOSTTY_CLIPBOARD_PRIMARY) == nil)
  }

  @Test
  func terminalAccentColorPrefersBrightestBlueCandidate() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 4=#458588
      palette = 12=#83A598
      """
    )

    #expect(hexString(runtime.terminalAccentColor()) == "#83A598")
  }

  @Test
  func terminalAccentColorUsesBrightBlueWhenBlueFails() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 4=#171717
      palette = 12=#83A598
      """
    )

    #expect(hexString(runtime.terminalAccentColor()) == "#83A598")
  }

  @Test
  func terminalAccentColorUsesBlueWhenBrightBlueFails() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 4=#458588
      palette = 12=#1F1F1F
      """
    )

    #expect(hexString(runtime.terminalAccentColor()) == "#458588")
  }

  @Test
  func terminalAccentColorFallsBackToForegroundWhenBlueCandidatesFail() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 4=#171717
      palette = 12=#202020
      """
    )

    #expect(hexString(runtime.terminalAccentColor()) == "#E0E0E0")
  }

  @Test
  func splitDividerColorUsesConfiguredValue() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      split-divider-color = #123456
      """
    )

    #expect(hexString(runtime.splitDividerColor()) == "#123456")
  }

  @Test
  func splitDividerColorFallsBackToDimmedBackground() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      """
    )

    #expect(hexString(runtime.splitDividerColor()) == "#0A0A0A")
  }

  @Test
  func unfocusedSplitDimmingUsesConfiguredFillAndOpacity() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      unfocused-split-fill = #202020
      unfocused-split-opacity = 0.42
      """
    )

    #expect(hexString(runtime.unfocusedSplitDimmingColor()) == "#202020")
    #expect(abs(runtime.unfocusedSplitDimmingOpacity() - 0.58) < 0.0001)
  }

  @Test
  func unfocusedSplitDimmingFallsBackToBackgroundAndDefaultOpacity() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      """
    )

    #expect(hexString(runtime.unfocusedSplitDimmingColor()) == "#101010")
    #expect(abs(runtime.unfocusedSplitDimmingOpacity() - 0.3) < 0.0001)
  }

  @Test
  func globalKeybindDetectionRequiresGlobalPrefix() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = super+shift+0=toggle_visibility
      """
    )

    #expect(!runtime.hasGlobalKeybinds())
  }

  @Test
  func globalKeybindDetectionReadsGhosttyConfig() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = global:super+shift+0=toggle_visibility
      """
    )

    #expect(runtime.hasGlobalKeybinds())
  }

  @Test
  func dispatchAppActionRoutesSupportedActions() {
    let app = NSApplication.shared
    let previousDelegate = app.delegate
    let delegate = GhosttyAppActionPerformerSpy()
    app.delegate = delegate
    defer {
      app.delegate = previousDelegate
    }

    #expect(
      GhosttyRuntime.dispatchAppAction(
        ghostty_action_s(
          tag: GHOSTTY_ACTION_NEW_WINDOW,
          action: ghostty_action_u())))
    #expect(
      GhosttyRuntime.dispatchAppAction(
        ghostty_action_s(
          tag: GHOSTTY_ACTION_CLOSE_ALL_WINDOWS,
          action: ghostty_action_u())))
    #expect(
      GhosttyRuntime.dispatchAppAction(
        ghostty_action_s(
          tag: GHOSTTY_ACTION_CHECK_FOR_UPDATES,
          action: ghostty_action_u())))
    for payload in [GHOSTTY_ACTION_OPEN_CONFIG_OS_OPEN, GHOSTTY_ACTION_OPEN_CONFIG_NEW_WINDOW] {
      var action = ghostty_action_u()
      action.open_config = payload
      #expect(
        GhosttyRuntime.dispatchAppAction(
          ghostty_action_s(
            tag: GHOSTTY_ACTION_OPEN_CONFIG,
            action: action)))
    }
    #expect(
      GhosttyRuntime.dispatchAppAction(
        ghostty_action_s(
          tag: GHOSTTY_ACTION_TOGGLE_VISIBILITY,
          action: ghostty_action_u())))
    #expect(GhosttyRuntime.dispatchAppAction(ghostty_action_s(tag: GHOSTTY_ACTION_QUIT, action: ghostty_action_u())))

    #expect(delegate.newWindowCount == 1)
    #expect(delegate.closeAllWindowsCount == 1)
    #expect(delegate.checkForUpdatesCount == 1)
    #expect(delegate.openConfigCount == 2)
    #expect(delegate.toggleVisibilityCount == 1)
    #expect(delegate.quitCount == 1)
  }

  @Test
  func dispatchAppActionReturnsFalseForUnsupportedActions() {
    #expect(
      !GhosttyRuntime.dispatchAppAction(
        ghostty_action_s(
          tag: GHOSTTY_ACTION_PRESENT_TERMINAL,
          action: ghostty_action_u())))
  }

  @Test
  func reloadAppConfigUsesOriginalExplicitConfigPath() throws {
    let fixture = try makePersistentGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      """
    )
    defer {
      fixture.cleanup()
    }

    #expect(hexString(fixture.runtime.backgroundColor()) == "#101010")

    try """
    background = #202020
    foreground = #E0E0E0
    """
    .write(to: fixture.configURL, atomically: true, encoding: .utf8)

    fixture.runtime.reloadAppConfig()

    #expect(hexString(fixture.runtime.backgroundColor()) == "#202020")
  }

  @Test
  func surfaceReloadActionReturnsHandledResult() throws {
    let runtime = try makeGhosttyRuntime("")
    let surfaceView = GhosttySurfaceView(
      runtime: runtime,
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    defer { surfaceView.closeSurface() }
    let surface = try #require(surfaceView.surface)
    var target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    target.target.surface = surface
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_RELOAD_CONFIG, action: ghostty_action_u())
    action.action.reload_config.soft = true

    #expect(
      GhosttyRuntime.actionCallbackForTesting(
        runtime.appBitsForTesting(),
        target,
        action
      )
    )
  }

  @Test
  func configurationDiagnosticsExposeTrimmedCurrentErrors() throws {
    let runtime = try makeGhosttyRuntime(
      """
      definitely-invalid-key = nope
      """
    )

    let diagnostics = runtime.configurationDiagnostics()

    #expect(!diagnostics.isEmpty)
    #expect(
      diagnostics.allSatisfy {
        !$0.isEmpty && $0 == $0.trimmingCharacters(in: .whitespacesAndNewlines)
      }
    )
  }

  @Test
  func validReloadClearsConfigurationDiagnostics() throws {
    let fixture = try makePersistentGhosttyRuntime(
      """
      definitely-invalid-key = nope
      """
    )
    defer {
      fixture.cleanup()
    }

    #expect(!fixture.runtime.configurationDiagnostics().isEmpty)

    try """
    background = #101010
    """
    .write(to: fixture.configURL, atomically: true, encoding: .utf8)

    fixture.runtime.reloadAppConfig()

    #expect(fixture.runtime.configurationDiagnostics().isEmpty)
  }

  @Test
  func invalidReloadReplacesConfigurationDiagnostics() throws {
    let fixture = try makePersistentGhosttyRuntime(
      """
      first-invalid-key = nope
      """
    )
    defer {
      fixture.cleanup()
    }

    let initialDiagnostics = fixture.runtime.configurationDiagnostics()
    #expect(initialDiagnostics.count == 1)
    #expect(initialDiagnostics[0].contains("first-invalid-key"))

    try """
    second-invalid-key = nope
    """
    .write(to: fixture.configURL, atomically: true, encoding: .utf8)

    fixture.runtime.reloadAppConfig()

    let reloadedDiagnostics = fixture.runtime.configurationDiagnostics()
    #expect(reloadedDiagnostics.count == 1)
    #expect(reloadedDiagnostics[0].contains("second-invalid-key"))
    #expect(!reloadedDiagnostics[0].contains("first-invalid-key"))
  }

  @Test
  func splitPreserveZoomOnNavigationReadsNavigationFlag() throws {
    let runtime = try makeGhosttyRuntime(
      """
      split-preserve-zoom = navigation
      """
    )

    #expect(runtime.splitPreserveZoomOnNavigation())
  }

  @Test
  func splitPreserveZoomOnNavigationDefaultsToDisabled() throws {
    let runtime = try makeGhosttyRuntime("")

    #expect(!runtime.splitPreserveZoomOnNavigation())
  }

  @Test
  func wakeupAfterRuntimeDeallocationIsIgnored() throws {
    let userdataBits: UInt?
    do {
      let runtime = try makeGhosttyRuntime(
        """
        background = #101010
        foreground = #E0E0E0
        """
      )
      userdataBits = runtime.appUserdataBitsForTesting()
    }

    GhosttyRuntime.wakeupForTesting(userdataBits: userdataBits)
  }

  @Test
  func wakeupCallbacksNeverTickInlineOrCoalesce() async throws {
    let runtime = try makeGhosttyRuntime("")
    let tickCount = Mutex(0)

    for _ in 0..<2 {
      GhosttyRuntime.wakeupForTesting(
        userdataBits: runtime.appUserdataBitsForTesting(),
        onTick: {
          tickCount.withLock { $0 += 1 }
        }
      )
    }

    #expect(tickCount.withLock { $0 } == 0)
    await withCheckedContinuation { continuation in
      DispatchQueue.main.async {
        continuation.resume()
      }
    }
    #expect(tickCount.withLock { $0 } == 2)
  }

  @Test
  func closeSurfaceCallbackRetainsBridgeUntilMainActorDelivery() async {
    let processStates = Mutex<[Bool]>([])
    var bridge: GhosttySurfaceBridge? = GhosttySurfaceBridge()
    weak let bridgeReference = bridge
    bridge?.onCloseRequest = { processAlive in
      processStates.withLock { $0.append(processAlive) }
    }
    let userdataBits = bridge.map {
      UInt(bitPattern: Unmanaged.passUnretained($0).toOpaque())
    }
    let callbackReturned = DispatchSemaphore(value: 0)

    DispatchQueue.global().async {
      GhosttyRuntime.closeSurfaceCallbackForTesting(userdataBits, processAlive: true)
      callbackReturned.signal()
    }
    waitForCallback(callbackReturned)
    bridge = nil

    #expect(bridgeReference != nil)
    #expect(processStates.withLock { $0 }.isEmpty)

    await withCheckedContinuation { continuation in
      DispatchQueue.main.async {
        continuation.resume()
      }
    }

    #expect(processStates.withLock { $0 } == [true])
    #expect(bridgeReference == nil)
  }

  private func waitForCallback(_ semaphore: DispatchSemaphore) {
    semaphore.wait()
  }

  @Test
  func actionCallbackReturnsHandledResultOffMainThread() async throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      """
    )
    let app = NSApplication.shared
    let previousDelegate = app.delegate
    let delegate = GhosttyAppActionPerformerSpy()
    app.delegate = delegate
    defer {
      app.delegate = previousDelegate
    }

    let action = ghostty_action_s(tag: GHOSTTY_ACTION_NEW_WINDOW, action: ghostty_action_u())
    let target = ghostty_target_s(tag: GHOSTTY_TARGET_APP, target: ghostty_target_u())
    let appBits = runtime.appBitsForTesting()
    let result = await Task.detached {
      GhosttyRuntime.actionCallbackForTesting(appBits, target, action)
    }.value

    #expect(result)
    #expect(delegate.newWindowCount == 1)
  }

  private func makeClipboardConfirmationPayload(
    contents: [(mime: String, data: Data)],
    request: ghostty_clipboard_request_e
  ) -> GhosttyClipboardConfirmationPayload? {
    var mimePointers: [UnsafeMutablePointer<CChar>] = []
    for content in contents {
      guard let pointer = strdup(content.mime) else { return nil }
      mimePointers.append(pointer)
    }
    defer {
      for pointer in mimePointers {
        free(pointer)
      }
    }

    let dataPointers = contents.map { content in
      let pointer = UnsafeMutableRawPointer.allocate(
        byteCount: max(content.data.count, 1),
        alignment: 1
      )
      content.data.withUnsafeBytes { bytes in
        guard let source = bytes.baseAddress else { return }
        pointer.copyMemory(from: source, byteCount: bytes.count)
      }
      return pointer
    }
    defer {
      for pointer in dataPointers {
        pointer.deallocate()
      }
    }

    let copiedContents = contents.indices.map { index in
      ghostty_clipboard_content_s(
        mime: mimePointers[index],
        data: dataPointers[index].assumingMemoryBound(to: CChar.self),
        len: contents[index].data.count,
        payload_id: index
      )
    }
    return copiedContents.withUnsafeBufferPointer { buffer in
      var confirmation = ghostty_clipboard_confirm_s(
        contents: buffer.baseAddress,
        contents_len: buffer.count,
        available: nil,
        available_len: 0,
        name: nil,
        can_remember: false
      )
      return withUnsafePointer(to: &confirmation) {
        GhosttyClipboardConfirmationPayload(copying: $0, request: request)
      }
    }
  }

  private func hexString(_ color: NSColor) -> String {
    let rgb = color.usingColorSpace(.sRGB) ?? color
    let red = Int(round(rgb.redComponent * 255))
    let green = Int(round(rgb.greenComponent * 255))
    let blue = Int(round(rgb.blueComponent * 255))
    return String(format: "#%02X%02X%02X", red, green, blue)
  }

  private func makePasteboard() -> NSPasteboard {
    let name = NSPasteboard.Name("supaterm-test-\(UUID().uuidString)")
    let pasteboard = NSPasteboard(name: name)
    pasteboard.clearContents()
    return pasteboard
  }

  private func makeImageData(_ fileType: NSBitmapImageRep.FileType) throws -> Data {
    guard
      let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: 1,
        pixelsHigh: 1,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 4,
        bitsPerPixel: 32
      )
    else {
      throw PasteboardImageTestError.encodingFailed
    }
    guard let pixels = rep.bitmapData else {
      throw PasteboardImageTestError.encodingFailed
    }
    pixels[0] = 255
    pixels[1] = 0
    pixels[2] = 0
    pixels[3] = 255
    guard let data = rep.representation(using: fileType, properties: [:]) else {
      throw PasteboardImageTestError.encodingFailed
    }
    return data
  }

  private func unescapedPath(_ escapedPath: String?) throws -> String {
    let escapedPath = try #require(escapedPath)
    var path = ""
    var isEscaped = false
    for character in escapedPath {
      if isEscaped {
        path.append(character)
        isEscaped = false
      } else if character == "\\" {
        isEscaped = true
      } else {
        path.append(character)
      }
    }
    if isEscaped {
      path.append("\\")
    }
    return path
  }

  private enum PasteboardImageTestError: Error {
    case encodingFailed
  }
}

@MainActor
private final class EffectiveAppearanceSource {
  private let initialAppearance: NSAppearance
  private var observer: ((NSAppearance) -> Void)?
  private(set) var isObserved = false

  init(initialAppearance: NSAppearance) {
    self.initialAppearance = initialAppearance
  }

  func observe(_ observer: @escaping (NSAppearance) -> Void) -> () -> Void {
    self.observer = observer
    isObserved = true
    observer(initialAppearance)
    return { [weak self] in
      self?.observer = nil
      self?.isObserved = false
    }
  }

  func send(_ appearance: NSAppearance) {
    observer?(appearance)
  }
}

private nonisolated final class PasteboardDataProviderSpy: NSObject,
  NSPasteboardItemDataProvider
{
  private let dataByType: [NSPasteboard.PasteboardType: Data]
  private(set) var requestedTypes: [NSPasteboard.PasteboardType] = []

  init(dataByType: [NSPasteboard.PasteboardType: Data] = [:]) {
    self.dataByType = dataByType
  }

  func pasteboard(
    _ pasteboard: NSPasteboard?,
    item: NSPasteboardItem,
    provideDataForType type: NSPasteboard.PasteboardType
  ) {
    requestedTypes.append(type)
    item.setData(dataByType[type] ?? Data([0xFF]), forType: type)
  }
}
