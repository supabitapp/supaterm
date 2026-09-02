import AppKit
import Foundation
import GhosttyKit
import Synchronization
import Testing

@testable import supaterm

@Suite(.serialized)
@MainActor
struct GhosttyHostManagedSessionTests {
  init() {
    _ = NSApplication.shared
    initializeGhosttyForTests()
  }

  @Test
  func surfaceHasNoProcessAndForwardsRendererIO() async throws {
    let inputs = Mutex<[Data]>([])
    let viewports = Mutex<[GhosttyHostManagedSession.Viewport]>([])
    let session = GhosttyHostManagedSession(
      onInput: { data in
        inputs.withLock { $0.append(data) }
      },
      onResize: { viewport in
        viewports.withLock { $0.append(viewport) }
      }
    )
    let view = GhosttySurfaceView(
      runtime: try makeGhosttyRuntime(""),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      hostManagedSession: session
    )
    defer { view.closeSurface() }
    let surface = try #require(view.surface)

    #expect(ghostty_surface_foreground_pid(surface) == 0)
    #expect(!session.restore(snapshot: Data("invalid snapshot".utf8)))
    #expect(session.write(Data("rendered output".utf8)))
    #expect(readText(from: surface).contains("rendered output"))

    inputs.withLock { $0.removeAll() }
    #expect(session.write(Data("\u{1B}[5n".utf8)))
    #expect(session.write(Data("\u{1B}[?1004h".utf8)))
    ghostty_surface_set_focus(surface, true)
    GhosttySurfaceView.withCommittedTextKey(
      action: GHOSTTY_ACTION_PRESS,
      text: "key"
    ) { key in
      #expect(ghostty_surface_key(surface, key))
    }
    "paste".withCString { pointer in
      ghostty_surface_text(surface, pointer, 5)
    }

    try await waitUntil {
      inputs.withLock { Data($0.joined()).count == 8 }
    }
    #expect(inputs.withLock { Data($0.joined()) } == Data("keypaste".utf8))

    inputs.withLock { $0.removeAll() }
    #expect(session.write(Data("\u{1B}[?1000h\u{1B}[?1006h".utf8)))
    ghostty_surface_mouse_pos(surface, 0, 0, GHOSTTY_MODS_NONE)
    #expect(
      ghostty_surface_mouse_button(
        surface,
        GHOSTTY_MOUSE_PRESS,
        GHOSTTY_MOUSE_LEFT,
        GHOSTTY_MODS_NONE
      )
    )
    try await waitUntil {
      inputs.withLock { !$0.isEmpty }
    }
    #expect(inputs.withLock { Data($0.joined()) } == Data("\u{1B}[<0;1;1M".utf8))

    let viewportCount = viewports.withLock { $0.count }
    ghostty_surface_set_size(surface, 900, 700)
    try await waitUntil {
      viewports.withLock { $0.count > viewportCount }
    }
    let viewport = try #require(viewports.withLock { $0.last })
    let size = ghostty_surface_size(surface)
    #expect(viewport.columns == size.columns)
    #expect(viewport.rows == size.rows)
    #expect(viewport.pixelWidth > 0 && viewport.pixelWidth <= size.width_px)
    #expect(viewport.pixelHeight > 0 && viewport.pixelHeight <= size.height_px)

    view.closeSurface()
    #expect(!session.write(Data("closed".utf8)))
  }

  @Test
  func teardownStopsSustainedReentrantOutput() throws {
    let session = GhosttyHostManagedSession(onInput: { _ in }, onResize: { _ in })
    let view = GhosttySurfaceView(
      runtime: try makeGhosttyRuntime(""),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      hostManagedSession: session
    )
    let payload = Data("output\u{1B}]2;host title\u{1B}\\\u{1B}]4;1;#102030\u{1B}\\".utf8)

    for _ in 0..<100 {
      #expect(session.write(payload))
    }
    view.closeSurface()
    for _ in 0..<100 {
      #expect(!session.write(payload))
    }
    #expect(view.surface == nil)
  }

  private func waitUntil(
    _ condition: @escaping @Sendable () -> Bool
  ) async throws {
    for _ in 0..<100 {
      if condition() { return }
      try await Task.sleep(for: .milliseconds(10))
    }
    Issue.record("condition timed out")
  }

  private func readText(from surface: ghostty_surface_t) -> String {
    var text = ghostty_text_s()
    guard ghostty_surface_read_text_tail(surface, 100, &text) else { return "" }
    defer { ghostty_surface_free_text(surface, &text) }
    return text.text.map(String.init(cString:)) ?? ""
  }
}
