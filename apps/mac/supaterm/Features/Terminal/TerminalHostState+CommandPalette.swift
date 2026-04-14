import Foundation

extension TerminalHostState {
  func commandPaletteGhosttyCommands() -> [GhosttyCommand] {
    _ = runtimeConfigGeneration
    return runtime?.commandPaletteEntries().filter(\.isSupported) ?? []
  }

  func commandPaletteGhosttyShortcutDisplayByAction() -> [String: String] {
    _ = runtimeConfigGeneration

    var displays: [String: String] = [:]
    for command in commandPaletteGhosttyCommands() {
      if let shortcut = runtime?.keyboardShortcut(forAction: command.action)?.display {
        displays[command.action] = shortcut
      }
    }
    return displays
  }

  func commandPaletteFocusTargets(windowControllerID: UUID) -> [TerminalCommandPaletteFocusTarget] {
    var targets: [TerminalCommandPaletteFocusTarget] = []

    for space in spaces {
      for tab in spaceManager.tabs(in: space.id) {
        guard let tree = trees[tab.id] else { continue }
        for surface in tree.leaves() {
          let displayTitle = surface.resolvedDisplayTitle(
            defaultValue: Self.paneFallbackTitle(for: surface.id, in: tree)
          )
          targets.append(
            .init(
              windowControllerID: windowControllerID,
              surfaceID: surface.id,
              title: displayTitle,
              subtitle: commandPaletteSubtitle(
                for: displayTitle,
                workingDirectory: surface.bridge.state.pwd
              ),
              tone: tab.tone
            )
          )
        }
      }
    }

    return targets
  }

  private func commandPaletteSubtitle(
    for displayTitle: String,
    workingDirectory: String?
  ) -> String? {
    guard let path = Self.trimmedNonEmpty(workingDirectory) else { return nil }
    let normalizedPath = GhosttySurfaceView.normalizedWorkingDirectoryPath(path)
    let abbreviatedPath = (normalizedPath as NSString).abbreviatingWithTildeInPath
    if displayTitle.contains(normalizedPath) || displayTitle.contains(abbreviatedPath) {
      return nil
    }
    return abbreviatedPath
  }
}
