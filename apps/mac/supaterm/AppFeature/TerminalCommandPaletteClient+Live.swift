import SupatermTerminalFeature

extension TerminalCommandPaletteClient {
  public static func live(registry: TerminalWindowRegistry) -> Self {
    Self(
      snapshot: { registry.commandPaletteSnapshot(windowID: $0) },
      focusPane: { registry.focusCommandPalettePane($0) },
      performUpdateAction: { registry.performCommandPaletteUpdateAction($1, windowID: $0) }
    )
  }
}
