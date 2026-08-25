import SupaTheme
import SupatermCLIShared

extension ThemeTint {
  init(socketColor: SupatermThemeColor) {
    self = Self.convert(socketColor)
  }

  var socketColor: SupatermThemeColor {
    Self.convert(self)
  }

  private static func convert<Source, Destination>(_ source: Source) -> Destination
  where
    Source: RawRepresentable,
    Destination: RawRepresentable,
    Source.RawValue == String,
    Destination.RawValue == String
  {
    guard let destination = Destination(rawValue: source.rawValue) else {
      preconditionFailure("Unsupported theme color: \(source.rawValue)")
    }
    return destination
  }
}

extension TerminalProject {
  var socketSnapshot: SupatermSnapshotProject {
    SupatermSnapshotProject(
      color: color.socketColor,
      id: id.rawValue,
      isPinned: isPinned,
      name: name,
      rootPath: rootPath
    )
  }
}
