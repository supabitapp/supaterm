import Foundation

/// Groups written into Info.plist by the config plugin. Absent on builds without push, such as
/// personal-team builds.
public struct PushConfiguration: Equatable {
  public let sharedKeychainGroup: String
  public let appGroup: String
  public let appKeychainGroup: String?

  public init?(infoDictionary: [String: Any]) {
    func value(_ key: String) -> String? {
      guard let value = infoDictionary[key] as? String, !value.isEmpty, !value.contains("$(") else { return nil }
      return value
    }
    guard let shared = value("SupatermPushKeychainGroup"), let appGroup = value("SupatermPushAppGroup") else {
      return nil
    }
    sharedKeychainGroup = shared
    self.appGroup = appGroup
    appKeychainGroup = value("SupatermPushAppKeychainGroup")
  }

  public static var main: PushConfiguration? {
    PushConfiguration(infoDictionary: Bundle.main.infoDictionary ?? [:])
  }

  public var recipients: PushRecipientStore { PushRecipientStore(accessGroup: sharedKeychainGroup) }

  public var ledger: PushReplayLedger? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup).map { PushReplayLedger(directory: $0) }
  }

  public var preferences: PushDevicePreferences? { PushDevicePreferences(appGroup: appGroup) }
}
