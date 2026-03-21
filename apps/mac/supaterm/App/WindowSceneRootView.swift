import SwiftUI

struct WindowSceneRootView: View {
  @StateObject private var controller: AppWindowController

  init(registry: TerminalWindowRegistry) {
    _controller = StateObject(wrappedValue: AppWindowController(registry: registry))
  }

  var body: some View {
    GhosttyColorSchemeSyncView(ghostty: controller.ghostty) {
      ContentView(
        store: controller.store,
        terminal: controller.terminal,
        ghosttyShortcuts: controller.ghosttyShortcuts,
        onWindowChanged: controller.updateWindow
      )
    }
  }
}
