import AppKit
import SwiftUI
import Synchronization
import Testing

@testable import supaterm

@Suite(.serialized)
@MainActor
struct ConfigDiagnosticsWindowControllerTests {
  init() {
    _ = NSApplication.shared
  }

  @Test
  func nonemptyDiagnosticsPresentWindow() throws {
    let controller = ConfigurationDiagnosticsWindowController()
    let window = try #require(controller.window)
    defer { controller.close() }

    controller.update(messages: ["unknown key"])

    #expect(window.isVisible)
  }

  @Test
  func windowMatchesConfigurationErrorsContract() throws {
    let controller = ConfigurationDiagnosticsWindowController()
    let window = try #require(controller.window)
    defer { controller.close() }

    #expect(window.title == "Configuration Errors")
    #expect(window.styleMask.contains(.titled))
    #expect(window.styleMask.contains(.closable))
    #expect(window.styleMask.contains(.miniaturizable))
    #expect(window.styleMask.contains(.resizable))
    #expect(window.level == .popUpMenu)
    #expect(window.tabbingMode == .disallowed)
    #expect(!window.isReleasedWhenClosed)
    #expect(!window.isRestorable)
  }

  @Test
  func emptyDiagnosticsCloseWindow() throws {
    let controller = ConfigurationDiagnosticsWindowController()
    let window = try #require(controller.window)
    defer { controller.close() }
    controller.update(messages: ["unknown key"])
    try #require(window.isVisible)

    controller.update(messages: [])

    #expect(!window.isVisible)

    controller.update(messages: ["new error"])

    #expect(controller.window === window)
    #expect(window.isVisible)
  }

  @Test
  func nonemptyUpdatesReuseWindowAndReplaceMessages() throws {
    let controller = ConfigurationDiagnosticsWindowController()
    let window = try #require(controller.window)
    defer { controller.close() }

    controller.update(messages: ["first error"])
    let hostingController = try #require(
      window.contentViewController as? NSHostingController<ConfigurationDiagnosticsView>
    )
    #expect(hostingController.rootView.messages == ["first error"])

    controller.update(messages: ["second error"])

    #expect(controller.window === window)
    #expect(hostingController.rootView.messages == ["second error"])
  }

  @Test
  func ignoreClearsMessagesAndClosesWindow() throws {
    let controller = ConfigurationDiagnosticsWindowController()
    let window = try #require(controller.window)
    defer { controller.close() }
    controller.update(messages: ["unknown key"])
    let hostingController = try #require(
      window.contentViewController as? NSHostingController<ConfigurationDiagnosticsView>
    )

    hostingController.rootView.onIgnore()

    #expect(hostingController.rootView.messages.isEmpty)
    #expect(!window.isVisible)
  }

  @Test
  func reloadPostsRuntimeReloadRequestOnce() throws {
    let notificationCenter = NotificationCenter()
    let controller = ConfigurationDiagnosticsWindowController(
      notificationCenter: notificationCenter
    )
    let window = try #require(controller.window)
    defer { controller.close() }
    let reloadCount = Mutex(0)
    let observer = notificationCenter.addObserver(
      forName: .ghosttyRuntimeReloadRequested,
      object: nil,
      queue: nil
    ) { _ in
      reloadCount.withLock { $0 += 1 }
    }
    defer { notificationCenter.removeObserver(observer) }
    controller.update(messages: ["unknown key"])
    let hostingController = try #require(
      window.contentViewController as? NSHostingController<ConfigurationDiagnosticsView>
    )

    hostingController.rootView.onReload()

    #expect(reloadCount.withLock { $0 } == 1)
  }
}
