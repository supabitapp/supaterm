import ComposableArchitecture
import CryptoKit
import Foundation
import Security
import SupatermCLIShared
import SupatermSupport

struct LicenseCredential: Equatable, Sendable {
  let rawValue: String
  let licenseID: String

  init?(_ value: String) {
    let value = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    let parts = value.split(separator: "-", omittingEmptySubsequences: false)
    guard
      parts.count == 3,
      parts[0] == "SUPATERM",
      parts[1].count == 26,
      parts[2].count == 26,
      let id = Self.decodeBase32(parts[1]),
      id.count == 16,
      Self.decodeBase32(parts[2])?.count == 16
    else { return nil }

    rawValue = value
    licenseID = id.map { String(format: "%02x", $0) }.joined()
  }

  private static func decodeBase32(_ value: Substring) -> [UInt8]? {
    let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".utf8)
    var bits = 0
    var buffer: UInt64 = 0
    var decoded: [UInt8] = []

    for byte in value.utf8 {
      guard let index = alphabet.firstIndex(of: byte) else { return nil }
      buffer = (buffer << 5) | UInt64(index)
      bits += 5
      if bits >= 8 {
        bits -= 8
        decoded.append(UInt8((buffer >> UInt64(bits)) & 255))
      }
    }

    guard bits == 2, buffer & 3 == 0 else { return nil }
    return decoded
  }
}

struct LicenseDevice: Equatable, Sendable {
  let id: String
  let name: String
  let appVersion: String

  init(id: String, name: String, appVersion: String) {
    self.id = id
    self.name = name
    self.appVersion = appVersion
  }

  static func current(
    hardwareUUID: String? = HardwareInfo.uuid(),
    name: String = Host.current().localizedName ?? ProcessInfo.processInfo.hostName,
    appVersion: String = AppBuild.version
  ) -> Self? {
    guard let hardwareUUID else { return nil }
    let value = "app.supabit.supaterm:device:v1:\(hardwareUUID)"
    let id = SHA256.hash(data: Data(value.utf8))
      .map { String(format: "%02x", $0) }
      .joined()
    return Self(id: id, name: name, appVersion: appVersion)
  }

  var refreshInterval: Duration {
    let value = Int(id.prefix(4), radix: 16) ?? 0
    return .seconds(86_400 + value % 3_601 - 1_800)
  }
}

struct LicenseServiceClient: Sendable {
  var activate: @Sendable (_ key: String, _ device: LicenseDevice) async throws -> String
  var deactivate: @Sendable (_ key: String, _ deviceID: String) async throws -> String
  var refresh: @Sendable (_ key: String, _ deviceID: String) async throws -> String

  init(
    activate: @escaping @Sendable (_ key: String, _ device: LicenseDevice) async throws -> String,
    deactivate: @escaping @Sendable (_ key: String, _ deviceID: String) async throws -> String,
    refresh: @escaping @Sendable (_ key: String, _ deviceID: String) async throws -> String
  ) {
    self.activate = activate
    self.deactivate = deactivate
    self.refresh = refresh
  }

  static func live(
    baseURL: URL = URL(string: "https://license.supaterm.com")!,
    session: URLSession = .shared
  ) -> Self {
    Self(
      activate: { key, device in
        try await request(
          path: "v1/activate",
          body: ActivateRequest(
            appVersion: device.appVersion,
            deviceID: device.id,
            deviceName: device.name,
            licenseKey: key
          ),
          baseURL: baseURL,
          session: session
        )
      },
      deactivate: { key, deviceID in
        try await request(
          path: "v1/deactivate",
          body: LicenseRequest(deviceID: deviceID, licenseKey: key),
          baseURL: baseURL,
          session: session
        )
      },
      refresh: { key, deviceID in
        try await request(
          path: "v1/refresh",
          body: LicenseRequest(deviceID: deviceID, licenseKey: key),
          baseURL: baseURL,
          session: session
        )
      }
    )
  }
}

struct LicenseStorageClient: Sendable {
  var acknowledgeNotice: @Sendable (LicenseNoticeAcknowledgement) throws -> Void
  var delete: @Sendable () throws -> Void
  var loadKey: @Sendable () throws -> String?
  var loadNoticeAcknowledgement: @Sendable () -> LicenseNoticeAcknowledgement?
  var loadToken: @Sendable () throws -> String?
  var save: @Sendable (_ key: String, _ token: String) throws -> Void

  init(
    acknowledgeNotice: @escaping @Sendable (LicenseNoticeAcknowledgement) throws -> Void = { _ in },
    delete: @escaping @Sendable () throws -> Void,
    loadKey: @escaping @Sendable () throws -> String?,
    loadNoticeAcknowledgement: @escaping @Sendable () -> LicenseNoticeAcknowledgement? = { nil },
    loadToken: @escaping @Sendable () throws -> String?,
    save: @escaping @Sendable (_ key: String, _ token: String) throws -> Void
  ) {
    self.acknowledgeNotice = acknowledgeNotice
    self.delete = delete
    self.loadKey = loadKey
    self.loadNoticeAcknowledgement = loadNoticeAcknowledgement
    self.loadToken = loadToken
    self.save = save
  }

  static func live(
    tokenURL: URL = SupatermStateRoot.fileURL("license.token"),
    noticeURL: URL = SupatermStateRoot.fileURL("license-notice.json")
  ) -> Self {
    let keychain = LicenseKeychain()
    let tokenFile = LicenseTokenFile(url: tokenURL)
    let noticeFile = LicenseNoticeAcknowledgementFile(url: noticeURL)
    return Self(
      acknowledgeNotice: noticeFile.save,
      delete: {
        try keychain.delete()
        tokenFile.delete()
        noticeFile.delete()
      },
      loadKey: {
        try keychain.load()
      },
      loadNoticeAcknowledgement: noticeFile.load,
      loadToken: {
        tokenFile.load()
      },
      save: { key, token in
        let previousToken = tokenFile.load()
        do {
          try tokenFile.save(token)
          try keychain.save(key)
        } catch {
          if let previousToken {
            try? tokenFile.save(previousToken)
          } else {
            tokenFile.delete()
          }
          throw error
        }
      }
    )
  }
}

struct LicenseEntitlementVerifier: Sendable {
  var decode: @Sendable (_ token: String, _ deviceID: String, _ licenseID: String) -> LicenseEntitlement?

  init(
    decode: @escaping @Sendable (_ token: String, _ deviceID: String, _ licenseID: String) -> LicenseEntitlement?
  ) {
    self.decode = decode
  }

  static func live(publicKeyRawRepresentation: Data) throws -> Self {
    let codec = try LicenseEntitlementCodec(
      publicKeyRawRepresentation: publicKeyRawRepresentation
    )
    return Self(
      decode: { token, deviceID, licenseID in
        codec.decode(
          token: token,
          expectedDeviceID: deviceID,
          expectedLicenseID: licenseID
        )
      }
    )
  }

  static var production: Self {
    do {
      return try live(
        publicKeyRawRepresentation: Data([
          0xec, 0x8f, 0x0e, 0xab, 0x93, 0x1e, 0xef, 0xa0,
          0xea, 0xdf, 0x06, 0xbb, 0xeb, 0xf4, 0xdf, 0x33,
          0x0a, 0x22, 0x22, 0x84, 0xda, 0x8b, 0x6b, 0x41,
          0x0a, 0x79, 0x6e, 0x46, 0x85, 0xc9, 0xde, 0xaf,
        ])
      )
    } catch {
      preconditionFailure("Invalid entitlement public key")
    }
  }
}

private actor LicenseSwitchCoordinator {
  private var cleanup: Task<Void, Never>?

  func waitForCleanup() async {
    await cleanup?.value
  }

  func scheduleCleanup(_ operation: @escaping @Sendable () async -> Void) {
    let previous = cleanup
    cleanup = Task {
      await previous?.value
      await operation()
    }
  }
}

public enum LicenseClientError: Error, Equatable, Sendable {
  case connectionRequired
  case inactiveLicense
  case invalidEntitlement
  case invalidLicenseKey
  case missingLicenseKey
  case server(code: String, message: String, deviceName: String?)

  public init(_ error: any Error) {
    self = error as? Self ?? .connectionRequired
  }
}

struct LicenseClient: Sendable {
  struct Snapshot: Equatable, Sendable {
    let entitlement: LicenseEntitlement?
    let hasLicenseKey: Bool
    let noticeAcknowledgement: LicenseNoticeAcknowledgement?

    init(
      entitlement: LicenseEntitlement?,
      hasLicenseKey: Bool,
      noticeAcknowledgement: LicenseNoticeAcknowledgement? = nil
    ) {
      self.entitlement = entitlement
      self.hasLicenseKey = hasLicenseKey
      self.noticeAcknowledgement = noticeAcknowledgement
    }
  }

  var acknowledgeNotice: @Sendable (LicenseNoticeAcknowledgement) throws -> Void
  var activate: @Sendable (_ key: String) async throws -> LicenseEntitlement
  var deactivate: @Sendable () async throws -> Void
  var load: @Sendable () -> Snapshot
  var refresh: @Sendable () async throws -> LicenseEntitlement
  var refreshInterval: @Sendable () -> Duration

  init(
    activate: @escaping @Sendable (_ key: String) async throws -> LicenseEntitlement,
    deactivate: @escaping @Sendable () async throws -> Void,
    load: @escaping @Sendable () -> Snapshot,
    refresh: @escaping @Sendable () async throws -> LicenseEntitlement,
    refreshInterval: @escaping @Sendable () -> Duration = { .seconds(86_400) }
  ) {
    self.init(
      acknowledgeNotice: { _ in },
      activate: activate,
      deactivate: deactivate,
      load: load,
      refresh: refresh,
      refreshInterval: refreshInterval
    )
  }

  init(
    acknowledgeNotice: @escaping @Sendable (LicenseNoticeAcknowledgement) throws -> Void,
    activate: @escaping @Sendable (_ key: String) async throws -> LicenseEntitlement,
    deactivate: @escaping @Sendable () async throws -> Void,
    load: @escaping @Sendable () -> Snapshot,
    refresh: @escaping @Sendable () async throws -> LicenseEntitlement,
    refreshInterval: @escaping @Sendable () -> Duration
  ) {
    self.acknowledgeNotice = acknowledgeNotice
    self.activate = activate
    self.deactivate = deactivate
    self.load = load
    self.refresh = refresh
    self.refreshInterval = refreshInterval
  }

  static func live(
    device: LicenseDevice,
    service: LicenseServiceClient,
    storage: LicenseStorageClient,
    verifier: LicenseEntitlementVerifier
  ) -> Self {
    let switchCoordinator = LicenseSwitchCoordinator()
    return Self(
      acknowledgeNotice: storage.acknowledgeNotice,
      activate: { value in
        guard let credential = LicenseCredential(value) else {
          throw LicenseClientError.invalidLicenseKey
        }
        await switchCoordinator.waitForCleanup()
        let oldCredential = try storage.loadKey().flatMap(LicenseCredential.init)
        let oldEntitlement = try oldCredential.flatMap { oldCredential in
          try storage.loadToken().flatMap {
            verifier.decode($0, device.id, oldCredential.licenseID)
          }
        }
        let token = try await service.activate(credential.rawValue, device)
        guard let entitlement = verifier.decode(token, device.id, credential.licenseID) else {
          throw LicenseClientError.invalidEntitlement
        }
        guard entitlement.status == .active else { throw LicenseClientError.inactiveLicense }

        try storage.save(credential.rawValue, token)

        if let oldCredential,
          oldCredential != credential,
          oldEntitlement == nil || oldEntitlement?.status == .active
        {
          await switchCoordinator.scheduleCleanup {
            _ = try? await service.deactivate(oldCredential.rawValue, device.id)
          }
        }
        return entitlement
      },
      deactivate: {
        guard
          let value = try storage.loadKey(),
          let credential = LicenseCredential(value)
        else {
          throw LicenseClientError.missingLicenseKey
        }
        let token = try await service.deactivate(credential.rawValue, device.id)
        guard
          let entitlement = verifier.decode(token, device.id, credential.licenseID),
          entitlement.status != .active
        else {
          throw LicenseClientError.invalidEntitlement
        }
        try storage.delete()
      },
      load: {
        guard
          let value = try? storage.loadKey(),
          let credential = LicenseCredential(value)
        else {
          return Snapshot(
            entitlement: nil,
            hasLicenseKey: false,
            noticeAcknowledgement: storage.loadNoticeAcknowledgement()
          )
        }
        let entitlement = try? storage.loadToken().flatMap {
          verifier.decode($0, device.id, credential.licenseID)
        }
        return Snapshot(
          entitlement: entitlement,
          hasLicenseKey: true,
          noticeAcknowledgement: storage.loadNoticeAcknowledgement()
        )
      },
      refresh: {
        guard
          let value = try storage.loadKey(),
          let credential = LicenseCredential(value)
        else {
          throw LicenseClientError.missingLicenseKey
        }
        let token = try await service.refresh(credential.rawValue, device.id)
        guard
          let received = verifier.decode(token, device.id, credential.licenseID)
        else {
          throw LicenseClientError.invalidEntitlement
        }
        let current = try storage.loadToken().flatMap {
          verifier.decode($0, device.id, credential.licenseID)
        }
        guard let current, current.revision >= received.revision else {
          try storage.save(credential.rawValue, token)
          return received
        }
        return current
      },
      refreshInterval: { device.refreshInterval }
    )
  }

  static func live(device: LicenseDevice) -> Self {
    live(
      device: device,
      service: .live(),
      storage: .live(),
      verifier: .production
    )
  }
}

extension LicenseClient {
  static var liveValue: Self {
    guard let device = LicenseDevice.current() else {
      return Self(
        activate: { _ in throw LicenseClientError.invalidEntitlement },
        deactivate: { throw LicenseClientError.invalidEntitlement },
        load: { Snapshot(entitlement: nil, hasLicenseKey: false) },
        refresh: { throw LicenseClientError.invalidEntitlement },
        refreshInterval: { .seconds(86_400) }
      )
    }
    return .live(device: device)
  }

  static var debugValue: Self {
    let device =
      LicenseDevice.current()
      ?? LicenseDevice(
        id: "debug-device",
        name: "Development Mac",
        appVersion: AppBuild.version
      )
    let store = LicenseDebugStore(device: device)
    return Self(
      activate: store.activate,
      deactivate: store.deactivate,
      load: store.load,
      refresh: store.refresh,
      refreshInterval: { .seconds(86_400) }
    )
  }

  static let testValue = Self(
    activate: unimplemented("LicenseClient.activate"),
    deactivate: unimplemented("LicenseClient.deactivate"),
    load: { Snapshot(entitlement: nil, hasLicenseKey: false) },
    refresh: unimplemented("LicenseClient.refresh"),
    refreshInterval: { .seconds(86_400) }
  )
}

private final class LicenseDebugStore: @unchecked Sendable {
  private let device: LicenseDevice
  private let lock = NSLock()
  private var entitlement: LicenseEntitlement?

  init(device: LicenseDevice) {
    self.device = device
  }

  func activate(_ value: String) throws -> LicenseEntitlement {
    guard let credential = LicenseCredential(value) else {
      throw LicenseClientError.invalidLicenseKey
    }
    let entitlement = LicenseEntitlement(
      licenseID: credential.licenseID,
      deviceID: device.id,
      status: .active,
      updatesThrough: LicenseDay("9999-12-31"),
      revision: 1,
      issuedAt: Int64(Date().timeIntervalSince1970),
      revocationReason: nil,
      signedToken: "debug"
    )
    lock.withLock { self.entitlement = entitlement }
    return entitlement
  }

  func deactivate() throws {
    try lock.withLock {
      guard entitlement != nil else { throw LicenseClientError.missingLicenseKey }
      entitlement = nil
    }
  }

  func load() -> LicenseClient.Snapshot {
    lock.withLock {
      LicenseClient.Snapshot(
        entitlement: entitlement,
        hasLicenseKey: entitlement != nil
      )
    }
  }

  func refresh() throws -> LicenseEntitlement {
    try lock.withLock {
      guard let entitlement else { throw LicenseClientError.missingLicenseKey }
      return entitlement
    }
  }
}

private struct ActivateRequest: Encodable {
  let appVersion: String
  let deviceID: String
  let deviceName: String
  let licenseKey: String

  enum CodingKeys: String, CodingKey {
    case appVersion = "app_version"
    case deviceID = "device_id"
    case deviceName = "device_name"
    case licenseKey = "license_key"
  }
}

private struct LicenseRequest: Encodable {
  let deviceID: String
  let licenseKey: String

  enum CodingKeys: String, CodingKey {
    case deviceID = "device_id"
    case licenseKey = "license_key"
  }
}

private struct LicenseTokenResponse: Decodable {
  let token: String
}

private struct LicenseErrorPayload: Decodable {
  let code: String
  let message: String
  let deviceName: String?

  enum CodingKeys: String, CodingKey {
    case code
    case message
    case deviceName = "device_name"
  }
}

private struct LicenseErrorResponse: Decodable {
  let error: LicenseErrorPayload
}

private func request<Body: Encodable & Sendable>(
  path: String,
  body: Body,
  baseURL: URL,
  session: URLSession
) async throws -> String {
  var request = URLRequest(url: baseURL.appending(path: path))
  request.timeoutInterval = SupatermLicenseTiming.networkRequestTimeout
  request.httpMethod = "POST"
  request.setValue("application/json", forHTTPHeaderField: "content-type")
  request.httpBody = try JSONEncoder().encode(body)

  let data: Data
  let response: URLResponse
  do {
    (data, response) = try await session.data(for: request)
  } catch is CancellationError {
    throw CancellationError()
  } catch {
    throw LicenseClientError.connectionRequired
  }

  guard let response = response as? HTTPURLResponse else {
    throw LicenseClientError.invalidEntitlement
  }
  guard (200..<300).contains(response.statusCode) else {
    guard let payload = try? JSONDecoder().decode(LicenseErrorResponse.self, from: data) else {
      throw LicenseClientError.invalidEntitlement
    }
    throw LicenseClientError.server(
      code: payload.error.code,
      message: payload.error.message,
      deviceName: payload.error.deviceName
    )
  }
  guard
    let token = try? JSONDecoder().decode(LicenseTokenResponse.self, from: data).token,
    !token.isEmpty
  else {
    throw LicenseClientError.invalidEntitlement
  }
  return token
}

struct LicenseKeychain: Sendable {
  private let identifier: String

  init(
    instanceName: String? = ProcessInfo.processInfo.environment["SUPATERM_INSTANCE_NAME"]
  ) {
    identifier = Self.identifier(instanceName: instanceName)
  }

  static func identifier(instanceName: String?) -> String {
    let base = "app.supabit.supaterm.license"
    guard let instanceName, instanceName != "default" else { return base }
    let suffix = SHA256.hash(data: Data(instanceName.utf8)).prefix(8)
      .map { String(format: "%02x", $0) }
      .joined()
    return "\(base).\(suffix)"
  }

  func load() throws -> String? {
    var result: CFTypeRef?
    let query = baseQuery.merging([
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnData as String: true,
    ]) { _, new in new }
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard
      status == errSecSuccess,
      let data = result as? Data,
      let value = String(data: data, encoding: .utf8)
    else {
      throw LicenseKeychainError()
    }
    return value
  }

  func save(_ value: String) throws {
    let data = Data(value.utf8)
    let status = SecItemUpdate(
      baseQuery as CFDictionary,
      [kSecValueData as String: data] as CFDictionary
    )
    if status == errSecSuccess { return }
    if status != errSecItemNotFound {
      throw LicenseKeychainError()
    }
    let add = baseQuery.merging([kSecValueData as String: data]) { _, new in new }
    let addStatus = SecItemAdd(add as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      throw LicenseKeychainError()
    }
  }

  func delete() throws {
    let status = SecItemDelete(baseQuery as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw LicenseKeychainError()
    }
  }

  private var baseQuery: [String: Any] {
    [
      kSecAttrAccount as String: identifier,
      kSecAttrService as String: identifier,
      kSecAttrSynchronizable as String: false,
      kSecClass as String: kSecClassGenericPassword,
    ]
  }
}

private struct LicenseKeychainError: Error {}
