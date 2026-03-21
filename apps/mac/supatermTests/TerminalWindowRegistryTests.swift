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
