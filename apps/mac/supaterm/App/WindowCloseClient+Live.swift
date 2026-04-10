extension WindowCloseClient {
  static func live(registry: TerminalWindowRegistry) -> Self {
    Self(
      closeWindow: { registry.closeWindow($0) },
      closeWindows: { registry.closeWindows($0) }
    )
  }
}
