import ExpoModulesCore
import Foundation

struct PushBindingRecord: Record {
  @Field var registrationId: String = ""
  @Field var keyId: String = ""
  @Field var environmentId: String = ""
  @Field var hostKey: String = ""
}

struct PushInstallationRecord: Record {
  @Field var installationId: String = ""
  @Field var ownerToken: String = ""
  @Field var token: String = ""
  @Field var topic: String = ""
  @Field var environment: String = ""
}

/// The APNs environment follows the provisioning profile the build was signed with, not the
/// variant: ad hoc and App Store profiles both deliver through production.
private func apnsEnvironment() -> String {
  #if targetEnvironment(simulator)
  return "sandbox"
  #else
  guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
        let data = try? Data(contentsOf: url),
        let raw = String(data: data, encoding: .isoLatin1),
        let start = raw.range(of: "<?xml"),
        let end = raw.range(of: "</plist>", range: start.lowerBound..<raw.endIndex),
        let plist = try? PropertyListSerialization.propertyList(
          from: Data(raw[start.lowerBound..<end.upperBound].utf8), format: nil
        ) as? [String: Any],
        let entitlements = plist["Entitlements"] as? [String: Any],
        let environment = entitlements["aps-environment"] as? String
  else { return "production" }
  return environment == "development" ? "sandbox" : "production"
  #endif
}

public final class SupatermPushModule: Module {
  private let lane = NSLock()

  private func run<T>(_ operation: (PushConfiguration) throws -> T) throws -> T {
    guard let configuration = PushConfiguration.main else { throw PushError.storage }
    lane.lock()
    defer { lane.unlock() }
    return try operation(configuration)
  }

  private func installations(_ configuration: PushConfiguration) throws -> PushInstallationStore {
    guard let group = configuration.appKeychainGroup else { throw PushError.storage }
    return PushInstallationStore(accessGroup: group)
  }

  public func definition() -> ModuleDefinition {
    Name("SupatermPush")

    Function("configuration") { () -> [String: Any] in
      guard PushConfiguration.main?.appKeychainGroup != nil else { return ["supported": false] }
      return [
        "supported": true,
        "apnsEnvironment": apnsEnvironment(),
        "topic": Bundle.main.bundleIdentifier ?? "",
      ]
    }

    AsyncFunction("generateRecipientKey") { () throws -> [String: String] in
      try self.run { configuration in
        let key = try configuration.recipients.generateKey()
        return ["keyId": key.keyId, "publicKey": key.publicKey]
      }
    }

    AsyncFunction("deleteOrphanKeys") { () throws in
      try self.run { configuration in
        let recipients = configuration.recipients
        for keyId in try recipients.orphanKeyIds() { try recipients.deleteKey(keyId) }
      }
    }

    AsyncFunction("saveBinding") { (record: PushBindingRecord) throws in
      try self.run { configuration in
        try configuration.recipients.saveBinding(PushBinding(
          registrationId: record.registrationId,
          keyId: record.keyId,
          environmentId: record.environmentId,
          hostKey: record.hostKey
        ))
      }
    }

    AsyncFunction("deleteBinding") { (registrationId: String) throws in
      try self.run { configuration in try configuration.recipients.deleteBinding(registrationId) }
    }

    AsyncFunction("listBindings") { () throws -> [[String: String]] in
      try self.run { configuration in
        try configuration.recipients.bindings().map {
          [
            "registrationId": $0.registrationId,
            "keyId": $0.keyId,
            "environmentId": $0.environmentId,
            "hostKey": $0.hostKey,
          ]
        }
      }
    }

    AsyncFunction("getHideContent") { () throws -> Bool in
      try self.run { configuration in configuration.preferences?.hideContent ?? false }
    }

    AsyncFunction("setHideContent") { (value: Bool) throws in
      try self.run { configuration in
        guard let preferences = configuration.preferences else { throw PushError.storage }
        preferences.hideContent = value
      }
    }

    AsyncFunction("getInstallation") { () throws -> [String: String]? in
      try self.run { configuration in
        guard let installation = try self.installations(configuration).load() else { return nil }
        return [
          "installationId": installation.installationId,
          "ownerToken": installation.ownerToken,
          "token": installation.token,
          "topic": installation.topic,
          "environment": installation.environment,
        ]
      }
    }

    AsyncFunction("setInstallation") { (record: PushInstallationRecord) throws in
      try self.run { configuration in
        try self.installations(configuration).save(PushInstallation(
          installationId: record.installationId,
          ownerToken: record.ownerToken,
          token: record.token,
          topic: record.topic,
          environment: record.environment
        ))
      }
    }

    AsyncFunction("clearInstallation") { () throws in
      try self.run { configuration in try self.installations(configuration).clear() }
    }
  }
}
