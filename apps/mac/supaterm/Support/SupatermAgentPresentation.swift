import SupatermCLIShared

extension SupatermAgentKind {
  public var markImageName: String {
    guard let imageName = TerminalCodingAgentCatalog.markImageName(for: rawValue) else {
      preconditionFailure("Missing coding agent mark")
    }
    return imageName
  }
}
