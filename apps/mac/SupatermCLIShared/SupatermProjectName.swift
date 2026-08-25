import Foundation

public enum SupatermProjectName {
  public static func key(_ name: String) -> String {
    name.trimmingCharacters(in: .whitespacesAndNewlines)
      .folding(options: [.caseInsensitive], locale: nil)
  }

  public static func matches(_ lhs: String, _ rhs: String) -> Bool {
    key(lhs) == key(rhs)
  }
}
