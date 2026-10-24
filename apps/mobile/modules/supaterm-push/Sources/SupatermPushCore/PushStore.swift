import CryptoKit
import Darwin
import Foundation
import Security

public protocol PushSecretStorage {
  func read(_ account: String) throws -> Data?
  func write(_ account: String, data: Data) throws
  func delete(_ account: String) throws
  func accounts() throws -> [String]
}

public struct PushKeychainStorage: PushSecretStorage {
  let service: String
  let accessGroup: String?

  public init(service: String, accessGroup: String?) {
    self.service = service
    self.accessGroup = accessGroup
  }

  private func query(_ account: String?) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecUseDataProtectionKeychain as String: true,
    ]
    if let account { query[kSecAttrAccount as String] = account }
    if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
    return query
  }

  public func read(_ account: String) throws -> Data? {
    var request = query(account)
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { throw PushError.storage }
    return data
  }

  public func write(_ account: String, data: Data) throws {
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let request = query(account)
    let updated = SecItemUpdate(request as CFDictionary, attributes as CFDictionary)
    if updated == errSecSuccess { return }
    guard updated == errSecItemNotFound else { throw PushError.storage }
    let inserted = request.merging(attributes) { _, new in new }
    guard SecItemAdd(inserted as CFDictionary, nil) == errSecSuccess else { throw PushError.storage }
  }

  public func delete(_ account: String) throws {
    let status = SecItemDelete(query(account) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw PushError.storage }
  }

  public func accounts() throws -> [String] {
    var request = query(nil)
    request[kSecReturnAttributes as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitAll
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    if status == errSecItemNotFound { return [] }
    guard status == errSecSuccess, let items = result as? [[String: Any]] else { throw PushError.storage }
    return items.compactMap { $0[kSecAttrAccount as String] as? String }
  }
}

public struct PushRecipientKey: Equatable, Sendable {
  public let keyId: String
  public let publicKey: String
}

public struct PushInstallation: Codable, Equatable, Sendable {
  public let installationId: String
  public let ownerToken: String
  public let token: String
  public let topic: String
  public let environment: String

  public init(installationId: String, ownerToken: String, token: String, topic: String, environment: String) {
    self.installationId = installationId
    self.ownerToken = ownerToken
    self.token = token
    self.topic = topic
    self.environment = environment
  }
}

/// Recipient keys and bindings live in the Keychain group the notification service extension shares.
public final class PushRecipientStore {
  private let storage: any PushSecretStorage

  public init(storage: any PushSecretStorage) {
    self.storage = storage
  }

  public convenience init(accessGroup: String) {
    self.init(storage: PushKeychainStorage(service: "com.supaterm.push.recipient", accessGroup: accessGroup))
  }

  public func generateKey() throws -> PushRecipientKey {
    let key = Curve25519.KeyAgreement.PrivateKey()
    let keyId = UUID().uuidString.lowercased()
    try storage.write("key:\(keyId)", data: key.rawRepresentation)
    return PushRecipientKey(keyId: keyId, publicKey: base64UrlEncode(key.publicKey.rawRepresentation))
  }

  public func privateKey(_ keyId: String) throws -> Curve25519.KeyAgreement.PrivateKey {
    guard isPushId(keyId), let raw = try storage.read("key:\(keyId)") else { throw PushError.unknownRegistration }
    do {
      return try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: raw)
    } catch {
      throw PushError.invalidKey
    }
  }

  public func deleteKey(_ keyId: String) throws {
    guard isPushId(keyId) else { throw PushError.invalidKey }
    try storage.delete("key:\(keyId)")
  }

  public func saveBinding(_ binding: PushBinding) throws {
    guard isPushId(binding.registrationId), isPushId(binding.keyId), !binding.environmentId.isEmpty,
          try base64UrlDecode(binding.hostKey, maxBytes: 32).count == 32
    else { throw PushError.invalidKey }
    _ = try privateKey(binding.keyId)
    try storage.write("binding:\(binding.registrationId)", data: JSONEncoder().encode(binding))
  }

  public func binding(_ registrationId: String) throws -> PushBinding {
    guard isPushId(registrationId), let data = try storage.read("binding:\(registrationId)")
    else { throw PushError.unknownRegistration }
    do {
      return try JSONDecoder().decode(PushBinding.self, from: data)
    } catch {
      throw PushError.storage
    }
  }

  /// Removes the binding and its key; a key belongs to exactly one registration.
  public func deleteBinding(_ registrationId: String) throws {
    guard isPushId(registrationId) else { throw PushError.invalidKey }
    if let binding = try? binding(registrationId) { try storage.delete("key:\(binding.keyId)") }
    try storage.delete("binding:\(registrationId)")
  }

  public func bindings() throws -> [PushBinding] {
    try storage.accounts()
      .filter { $0.hasPrefix("binding:") }
      .compactMap { try? binding(String($0.dropFirst("binding:".count))) }
      .sorted { $0.registrationId < $1.registrationId }
  }

  /// Keys with no binding, left behind when registration failed between key generation and binding.
  public func orphanKeyIds() throws -> [String] {
    let bound = Set(try bindings().map(\.keyId))
    return try storage.accounts().filter { $0.hasPrefix("key:") }.map { String($0.dropFirst("key:".count)) }
      .filter { !bound.contains($0) }
  }

  public func decrypt(_ envelope: PushEnvelope, now: Int64, ledger: PushReplayLedger) throws -> PushContent {
    guard isPushId(envelope.registrationId) else { throw PushError.invalidEnvelope }
    let binding = try binding(envelope.registrationId)
    guard binding.keyId == envelope.keyId else { throw PushError.unknownRegistration }
    let content = try openPushEnvelope(envelope, binding: binding, privateKey: privateKey(binding.keyId), now: now)
    guard try ledger.claim(envelope.notificationId, now: now) else { throw PushError.replayed }
    return content
  }
}

/// The gateway owner token never leaves the app's own Keychain group.
public final class PushInstallationStore {
  private let storage: any PushSecretStorage

  public init(storage: any PushSecretStorage) {
    self.storage = storage
  }

  public convenience init(accessGroup: String) {
    self.init(storage: PushKeychainStorage(service: "com.supaterm.push.installation", accessGroup: accessGroup))
  }

  public func load() throws -> PushInstallation? {
    guard let data = try storage.read("installation") else { return nil }
    return try? JSONDecoder().decode(PushInstallation.self, from: data)
  }

  public func save(_ installation: PushInstallation) throws {
    try storage.write("installation", data: JSONEncoder().encode(installation))
  }

  public func clear() throws {
    try storage.delete("installation")
  }
}

public struct PushReplayLedger {
  public static let retentionMs: Int64 = 48 * 60 * 60 * 1000
  private let directory: URL
  private let capacity: Int

  public init(directory: URL, capacity: Int = 4096) {
    self.directory = directory
    self.capacity = capacity
  }

  /// Records the notification and answers whether it was new. Holds an exclusive file lock because
  /// the extension can run several instances at once.
  public func claim(_ notificationId: String, now: Int64) throws -> Bool {
    let lockPath = directory.appendingPathComponent("supaterm-push-replay.lock").path
    let descriptor = open(lockPath, O_CREAT | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw PushError.storage }
    defer { close(descriptor) }
    guard flock(descriptor, LOCK_EX) == 0 else { throw PushError.storage }
    defer { flock(descriptor, LOCK_UN) }
    let url = directory.appendingPathComponent("supaterm-push-replay.json")
    var seen: [String: Int64] = [:]
    if let data = try? Data(contentsOf: url) {
      seen = (try? JSONDecoder().decode([String: Int64].self, from: data)) ?? [:]
    }
    seen = seen.filter { now - $0.value < Self.retentionMs }
    if seen[notificationId] != nil { return false }
    if seen.count >= capacity {
      for (id, _) in seen.sorted(by: { $0.value < $1.value }).prefix(seen.count - capacity + 1) {
        seen.removeValue(forKey: id)
      }
    }
    seen[notificationId] = now
    do {
      try JSONEncoder().encode(seen).write(
        to: url,
        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
      )
    } catch {
      throw PushError.storage
    }
    return true
  }
}

public struct PushDevicePreferences {
  private static let hideContentKey = "supaterm.push.hideContent"
  private let defaults: UserDefaults

  public init?(appGroup: String) {
    guard let defaults = UserDefaults(suiteName: appGroup) else { return nil }
    self.defaults = defaults
  }

  public init(defaults: UserDefaults) {
    self.defaults = defaults
  }

  public var hideContent: Bool {
    get { defaults.bool(forKey: Self.hideContentKey) }
    nonmutating set { defaults.set(newValue, forKey: Self.hideContentKey) }
  }
}
