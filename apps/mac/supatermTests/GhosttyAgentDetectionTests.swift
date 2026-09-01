import AppKit
import Darwin
import GhosttyKit
import Testing

@testable import supaterm

@Suite(.serialized)
@MainActor
struct GhosttyAgentDetectionTests {
  @Test
  func activeScreenTextReadsWholeActiveScreenRegardlessOfViewport() async throws {
    let command = [
      #"/bin/sh -c 'i=0; while [ "$i" -lt 80 ]; do "#,
      #"printf "history-%03d\n" "$i"; i=$((i + 1)); done; "#,
      #"printf "active-top\ncurrent-1\ncurrent-2\ncurrent-3\nactive-bottom"; cat'"#,
    ].joined()
    let fixture = try GhosttyAgentDetectionFixture(
      command: command
    )
    defer { fixture.close() }

    let initial = try #require(
      try await waitForValue {
        fixture.surface.activeScreenText(maximumUTF8Bytes: 64 * 1_024)
      } matching: {
        $0.contains("active-top") && $0.contains("active-bottom")
      }
    )
    #expect(!initial.contains("history-000"))
    #expect(fixture.surface.performBindingAction("scroll_to_top"))

    let visible = try #require(
      try await waitForValue {
        fixture.surface.captureText(scope: .visible, lines: nil)
      } matching: {
        $0.contains("history-000")
      }
    )
    let active = try #require(fixture.surface.activeScreenText(maximumUTF8Bytes: 64 * 1_024))

    #expect(visible != active)
    #expect(active == initial)
  }

  @Test
  func activeScreenTextTracksAlternateScreen() async throws {
    let command = [
      #"/bin/sh -c 'printf "primary-screen"; "#,
      #"printf "\033[?1049halt-top\nalt-bottom"; "#,
      #"IFS= read -r ignored; printf "\033[?1049l"; cat'"#,
    ].joined()
    let fixture = try GhosttyAgentDetectionFixture(
      command: command
    )
    defer { fixture.close() }

    let alternate = try #require(
      try await waitForValue {
        fixture.surface.activeScreenText(maximumUTF8Bytes: 64 * 1_024)
      } matching: {
        $0.contains("alt-top") && $0.contains("alt-bottom")
      }
    )
    #expect(!alternate.contains("primary-screen"))

    fixture.surface.bridge.submitText("return")

    let primary = try #require(
      try await waitForValue {
        fixture.surface.activeScreenText(maximumUTF8Bytes: 64 * 1_024)
      } matching: {
        $0.contains("primary-screen")
      }
    )
    #expect(!primary.contains("alt-top"))
    #expect(!primary.contains("alt-bottom"))
  }

  @Test
  func activeScreenTextKeepsGhosttyWhitespaceInvariant() async throws {
    let fixture = try GhosttyAgentDetectionFixture(
      command: #"/bin/sh -c 'printf "trailing   \n\n\n"; cat'"#
    )
    defer { fixture.close() }

    let text = try #require(
      try await waitForValue {
        fixture.surface.activeScreenText(maximumUTF8Bytes: 64 * 1_024)
      } matching: {
        $0.contains("trailing")
      }
    )

    #expect(text.hasSuffix("trailing   "))
  }

  @Test
  func boundedActiveScreenTextKeepsValidUTF8Bottom() async throws {
    let fixture = try GhosttyAgentDetectionFixture(
      command: #"/bin/sh -c 'printf "prefix-🙂Z"; cat'"#
    )
    defer { fixture.close() }

    _ = try #require(
      try await waitForValue {
        fixture.surface.activeScreenText(maximumUTF8Bytes: 64 * 1_024)
      } matching: {
        $0.contains("prefix-🙂Z")
      }
    )

    #expect(fixture.surface.activeScreenText(maximumUTF8Bytes: 5) == "🙂Z")
    #expect(fixture.surface.activeScreenText(maximumUTF8Bytes: 4) == "Z")
    #expect(fixture.surface.activeScreenText(maximumUTF8Bytes: 1) == "Z")
    #expect(fixture.surface.activeScreenText(maximumUTF8Bytes: 0)?.isEmpty == true)
  }

  @Test
  func activeScreenTextSkipsPasswordInputAndClosedSurface() async throws {
    let fixture = try GhosttyAgentDetectionFixture(
      command: #"/bin/sh -c 'printf "screen-marker"; cat'"#
    )
    defer { fixture.close() }

    _ = try #require(
      try await waitForValue {
        fixture.surface.activeScreenText(maximumUTF8Bytes: 64 * 1_024)
      } matching: {
        $0.contains("screen-marker")
      }
    )

    fixture.surface.passwordInput = true
    #expect(fixture.surface.activeScreenText(maximumUTF8Bytes: 64 * 1_024) == nil)
    fixture.surface.passwordInput = false
    #expect(fixture.surface.activeScreenText(maximumUTF8Bytes: 64 * 1_024) != nil)

    fixture.surface.closeSurface()
    #expect(fixture.surface.activeScreenText(maximumUTF8Bytes: 64 * 1_024) == nil)
    #expect(fixture.surface.foregroundProcessGroupID == nil)
  }

  @Test
  func activeScreenTextReadsInBackground() async throws {
    let fixture = try GhosttyAgentDetectionFixture(
      command: #"/bin/sh -c 'printf "background-screen-marker"; cat'"#
    )
    defer { fixture.close() }

    _ = try #require(
      try await waitForValue {
        fixture.surface.activeScreenText(maximumUTF8Bytes: 64 * 1_024)
      } matching: {
        $0.contains("background-screen-marker")
      }
    )

    let text = await fixture.surface.activeScreenTextInBackground(
      maximumUTF8Bytes: 64 * 1_024
    )

    #expect(text?.contains("background-screen-marker") == true)

    fixture.surface.passwordInput = true

    #expect(
      await fixture.surface.activeScreenTextInBackground(maximumUTF8Bytes: 64 * 1_024) == nil
    )
  }

  @Test
  func terminalTitleIgnoresUserOverride() async throws {
    let fixture = try GhosttyAgentDetectionFixture(
      command: #"/bin/sh -c 'printf "\033]0;raw-agent-title\007title-ready"; cat'"#
    )
    defer { fixture.close() }

    let title = try #require(
      try await waitForValue {
        fixture.surface.bridge.state.title
      } matching: {
        $0 == "raw-agent-title"
      }
    )
    #expect(title == "raw-agent-title")

    fixture.surface.setTitleOverride("user-title")

    #expect(fixture.surface.bridge.state.title == "raw-agent-title")
    #expect(fixture.surface.effectiveTitle() == "user-title")
  }

  @Test
  func foregroundProcessGroupIDTracksLiveForegroundJob() async throws {
    initializeGhosttyForTests()
    let runtime = try makeGhosttyRuntime("")
    let surface = GhosttySurfaceView(
      runtime: runtime,
      tabID: UUID(),
      workingDirectory: nil,
      shellPath: "/bin/sh",
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      zmxSessionsEnabled: false
    )
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("supaterm-agent-detection-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let childProcessGroupIDURL = directory.appendingPathComponent("child.pgid")
    var childProcessGroupID: Int32?
    defer {
      if let childProcessGroupID {
        _ = Darwin.kill(-childProcessGroupID, SIGKILL)
      }
      surface.closeSurface()
      try? FileManager.default.removeItem(at: directory)
    }

    let shellProcessGroupID = try #require(
      try await waitForValue {
        surface.foregroundProcessGroupID
      } matching: {
        $0 > 0
      }
    )
    surface.bridge.submitText(
      "/bin/sh -c 'ps -o pgid= -p $$ > \(childProcessGroupIDURL.path); exec /bin/sleep 120'"
    )

    childProcessGroupID = try await waitForProcessGroupID(at: childProcessGroupIDURL)
    let expectedChildProcessGroupID = try #require(childProcessGroupID)
    let foregroundJobProcessGroupID = try #require(
      try await waitForValue {
        surface.foregroundProcessGroupID
      } matching: {
        $0 == expectedChildProcessGroupID
      }
    )

    #expect(foregroundJobProcessGroupID != shellProcessGroupID)
    #expect(Darwin.kill(-foregroundJobProcessGroupID, SIGTERM) == 0)
    _ = try #require(
      try await waitForValue {
        surface.foregroundProcessGroupID
      } matching: {
        $0 != foregroundJobProcessGroupID
      }
    )
  }
}

@MainActor
private final class GhosttyAgentDetectionFixture {
  let runtime: GhosttyRuntime
  let surface: GhosttySurfaceView
  let window: NSWindow

  init(command: String) throws {
    initializeGhosttyForTests()
    runtime = try makeGhosttyRuntime("")
    surface = GhosttySurfaceView(
      runtime: runtime,
      tabID: UUID(),
      workingDirectory: nil,
      shellPath: "/bin/sh",
      startupCommand: .exec(["/bin/sh", "-c", command], searchPath: "/usr/bin:/bin"),
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      zmxSessionsEnabled: false
    )
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 640, height: 320),
      styleMask: [.titled, .closable],
      backing: .buffered,
      defer: false
    )
    window.contentView = surface
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(surface)
  }

  func close() {
    surface.passwordInput = false
    surface.closeSurface()
    window.contentView = nil
    window.orderOut(nil)
  }
}

@MainActor
private func waitForValue<Value>(
  attempts: Int = 500,
  read: () -> Value?,
  matching predicate: (Value) -> Bool
) async throws -> Value? {
  for _ in 0..<attempts {
    if let value = read(), predicate(value) {
      return value
    }
    try await Task.sleep(for: .milliseconds(10))
  }
  return nil
}

private func waitForProcessGroupID(at url: URL) async throws -> Int32? {
  for _ in 0..<500 {
    if let value = try? String(contentsOf: url, encoding: .utf8)
      .trimmingCharacters(in: .whitespacesAndNewlines),
      let processGroupID = Int32(value)
    {
      return processGroupID
    }
    try await Task.sleep(for: .milliseconds(10))
  }
  return nil
}
