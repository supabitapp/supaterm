import AppKit
import ComposableArchitecture
import Testing

@testable import supaterm

@MainActor
struct TerminalWindowRegistryTests {
  @Test
  func commandAvailabilityReflectsSelectedTabInActiveWindow() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let sceneID = UUID()

      let tabManager = try #require(host.workspaceManager.activeTabManager)
      let tabID = tabManager.createTab(title: "Terminal 1", icon: "terminal")
      _ = tabManager.selectTab(tabID)

      registry.register(
        keyboardShortcut: { _ in nil },
        sceneID: sceneID,
        store: store,
        terminal: host
      )
      registry.updateWindow(makeWindow(), for: sceneID)

      #expect(
        registry.commandAvailability()
          == .init(
            hasWindow: true,
            hasTab: true,
            hasSurface: false
          )
      )
    }
  }

  @Test
  func requestCloseTabInKeyWindowDispatchesReducerCommand() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      let recorder = TerminalCommandRecorder()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      } withDependencies: {
        $0.terminalClient.send = { recorder.record($0) }
      }
      let sceneID = UUID()

      let tabManager = try #require(host.workspaceManager.activeTabManager)
      let tabID = tabManager.createTab(title: "Terminal 1", icon: "terminal")
      _ = tabManager.selectTab(tabID)

      registry.register(
        keyboardShortcut: { _ in nil },
        sceneID: sceneID,
        store: store,
        terminal: host
      )
      registry.updateWindow(makeWindow(), for: sceneID)

      registry.requestCloseTabInKeyWindow()
      await flushEffects()

      #expect(recorder.commands == [.requestCloseTab(tabID)])
    }
  }

  @Test
  func requestNewTabInKeyWindowDispatchesReducerCommand() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      let recorder = TerminalCommandRecorder()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      } withDependencies: {
        $0.terminalClient.send = { recorder.record($0) }
      }
      let sceneID = UUID()

      registry.register(
        keyboardShortcut: { _ in nil },
        sceneID: sceneID,
        store: store,
        terminal: host
      )
      registry.updateWindow(makeWindow(), for: sceneID)

      registry.requestNewTabInKeyWindow()
      await flushEffects()

      #expect(recorder.commands == [.createTab(inheritingFromSurfaceID: nil)])
    }
  }

  @Test
  func closeAllWindowsPlanUsesSingleConfirmationWindow() {
    let confirmWindow = makeWindow()
    let secondWindow = makeWindow()

    let plan = TerminalWindowRegistry.closeAllWindowsPlan(
      for: [
        .init(window: confirmWindow, needsConfirmation: true),
        .init(window: secondWindow, needsConfirmation: false),
      ]
    )

    switch plan {
    case .confirm(let plannedConfirmWindow, let windows):
      #expect(plannedConfirmWindow === confirmWindow)
      #expect(windows.count == 2)
      #expect(windows[0] === confirmWindow)
      #expect(windows[1] === secondWindow)
    default:
      Issue.record("Expected confirm plan")
    }
  }

  @Test
  func closeAllWindowsPlanClosesImmediatelyWhenNoWindowNeedsConfirmation() {
    let firstWindow = makeWindow()
    let secondWindow = makeWindow()

    let plan = TerminalWindowRegistry.closeAllWindowsPlan(
      for: [
        .init(window: firstWindow, needsConfirmation: false),
        .init(window: secondWindow, needsConfirmation: false),
      ]
    )

    switch plan {
    case .closeImmediately(let windows):
      #expect(windows.count == 2)
      #expect(windows[0] === firstWindow)
      #expect(windows[1] === secondWindow)
    default:
      Issue.record("Expected immediate close plan")
    }
  }

  @Test
  func closeAllWindowsPlanReturnsNoWindowsWhenEmpty() {
    let plan = TerminalWindowRegistry.closeAllWindowsPlan(for: [])

    switch plan {
    case .noWindows:
      break
    default:
      Issue.record("Expected no windows plan")
    }
  }

  private func makeWindow() -> NSWindow {
    NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1_440, height: 900),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
  }

  private func flushEffects() async {
    for _ in 0..<5 {
      await Task.yield()
    }
  }
}
