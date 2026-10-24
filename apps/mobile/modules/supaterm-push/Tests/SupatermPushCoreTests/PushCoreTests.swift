import CryptoKit
import Foundation
import XCTest
@testable import SupatermPushCore

private struct Vectors: Decodable {
  struct Key: Decodable {
    let secretKey: String
    let publicKey: String
  }

  struct Recipient: Decodable {
    let registrationId: String
    let keyId: String
    let privateKey: String
    let publicKey: String
  }

  struct Case: Decodable {
    let name: String
    let content: PushContent
    let aad: String
    let signatureData: String
    let plaintext: String
    let envelope: PushEnvelope
  }

  struct Rfc9180: Decodable {
    struct Encryption: Decodable {
      let aad: String
      let pt: String
      let ct: String
    }

    let info: String
    let skRm: String
    let pkRm: String
    let enc: String
    let encryptions: [Encryption]
  }

  let hpkeInfo: String
  let host: Key
  let recipient: Recipient
  let envelopes: [Case]
  let rfc9180: Rfc9180

  static func load() throws -> Vectors {
    var root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    while !FileManager.default.fileExists(atPath: root.appendingPathComponent("pnpm-workspace.yaml").path),
          root.path != "/" {
      root.deleteLastPathComponent()
    }
    let data = try Data(contentsOf: root.appendingPathComponent("packages/shared/src/push/vectors.json"))
    return try JSONDecoder().decode(Vectors.self, from: data)
  }
}

private final class MemoryStorage: PushSecretStorage {
  var items: [String: Data] = [:]
  func read(_ account: String) throws -> Data? { items[account] }
  func write(_ account: String, data: Data) throws { items[account] = data }
  func delete(_ account: String) throws { items.removeValue(forKey: account) }
  func accounts() throws -> [String] { Array(items.keys) }
}

private func hex(_ value: String) -> Data {
  var data = Data()
  var index = value.startIndex
  while index < value.endIndex {
    let next = value.index(index, offsetBy: 2)
    data.append(UInt8(value[index..<next], radix: 16)!)
    index = next
  }
  return data
}

private func temporaryDirectory() throws -> URL {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

final class PushCoreTests: XCTestCase {
  private var vectors: Vectors!
  private var storage: MemoryStorage!
  private var store: PushRecipientStore!

  override func setUpWithError() throws {
    vectors = try Vectors.load()
    storage = MemoryStorage()
    store = PushRecipientStore(storage: storage)
    let recipient = vectors.recipient
    storage.items["key:\(recipient.keyId)"] = try base64UrlDecode(recipient.privateKey, maxBytes: 32)
    try store.saveBinding(PushBinding(
      registrationId: recipient.registrationId,
      keyId: recipient.keyId,
      environmentId: "environment-7f3a",
      hostKey: vectors.host.publicKey
    ))
  }

  private var binding: PushBinding { try! store.binding(vectors.recipient.registrationId) }

  private func privateKey() throws -> Curve25519.KeyAgreement.PrivateKey {
    try store.privateKey(vectors.recipient.keyId)
  }

  private func now(_ envelope: PushEnvelope) -> Int64 { envelope.createdAt + 1_000 }

  private func resigned(_ envelope: PushEnvelope, createdAt: Int64, expiresAt: Int64) throws -> PushEnvelope {
    let unsigned = PushEnvelope(
      v: envelope.v, registrationId: envelope.registrationId, keyId: envelope.keyId,
      notificationId: envelope.notificationId, createdAt: createdAt, expiresAt: expiresAt,
      enc: envelope.enc, ciphertext: envelope.ciphertext, signature: ""
    )
    let host = try Curve25519.Signing.PrivateKey(rawRepresentation: base64UrlDecode(vectors.host.secretKey, maxBytes: 32))
    let signature = try host.signature(for: Data(unsigned.signatureData.utf8))
    return PushEnvelope(
      v: envelope.v, registrationId: envelope.registrationId, keyId: envelope.keyId,
      notificationId: envelope.notificationId, createdAt: createdAt, expiresAt: expiresAt,
      enc: envelope.enc, ciphertext: envelope.ciphertext, signature: base64UrlEncode(signature)
    )
  }

  func testRecipientKeyMatchesVector() throws {
    XCTAssertEqual(base64UrlEncode(try privateKey().publicKey.rawRepresentation), vectors.recipient.publicKey)
    XCTAssertEqual(String(decoding: pushHpkeInfo, as: UTF8.self), vectors.hpkeInfo)
  }

  func testOpensEveryHostVector() throws {
    XCTAssertEqual(vectors.envelopes.count, 6)
    for vector in vectors.envelopes {
      XCTAssertEqual(vector.envelope.associatedData, vector.aad, vector.name)
      XCTAssertEqual(vector.envelope.signatureData, vector.signatureData, vector.name)
      XCTAssertTrue(pushPlaintextSizes.contains(vector.plaintext.utf8.count), vector.name)
      XCTAssertEqual(try unpadPushPlaintext(Data(vector.plaintext.utf8)), vector.content, vector.name)
      let content = try openPushEnvelope(
        vector.envelope, binding: binding, privateKey: privateKey(), now: now(vector.envelope)
      )
      XCTAssertEqual(content, vector.content, vector.name)
    }
  }

  func testRejectsTamperedEnvelopes() throws {
    let envelope = vectors.envelopes[0].envelope
    let key = try privateKey()
    let now = now(envelope)

    let otherHost = PushBinding(
      registrationId: binding.registrationId, keyId: binding.keyId, environmentId: binding.environmentId,
      hostKey: base64UrlEncode(Curve25519.Signing.PrivateKey().publicKey.rawRepresentation)
    )
    XCTAssertThrowsError(try openPushEnvelope(envelope, binding: otherHost, privateKey: key, now: now)) {
      XCTAssertEqual($0 as? PushError, .invalidSignature)
    }

    var ciphertext = Array(envelope.ciphertext)
    ciphertext[10] = ciphertext[10] == "A" ? "B" : "A"
    let flipped = PushEnvelope(
      v: 1, registrationId: envelope.registrationId, keyId: envelope.keyId,
      notificationId: envelope.notificationId, createdAt: envelope.createdAt, expiresAt: envelope.expiresAt,
      enc: envelope.enc, ciphertext: String(ciphertext), signature: envelope.signature
    )
    XCTAssertThrowsError(try openPushEnvelope(flipped, binding: binding, privateKey: key, now: now)) {
      XCTAssertEqual($0 as? PushError, .invalidSignature)
    }

    let otherKey = PushBinding(
      registrationId: binding.registrationId, keyId: UUID().uuidString.lowercased(),
      environmentId: binding.environmentId, hostKey: binding.hostKey
    )
    XCTAssertThrowsError(try openPushEnvelope(envelope, binding: otherKey, privateKey: key, now: now)) {
      XCTAssertEqual($0 as? PushError, .unknownRegistration)
    }

    let otherEnvironment = PushBinding(
      registrationId: binding.registrationId, keyId: binding.keyId, environmentId: "environment-other",
      hostKey: binding.hostKey
    )
    XCTAssertThrowsError(try openPushEnvelope(envelope, binding: otherEnvironment, privateKey: key, now: now)) {
      XCTAssertEqual($0 as? PushError, .invalidContent)
    }

    XCTAssertThrowsError(
      try openPushEnvelope(envelope, binding: binding, privateKey: Curve25519.KeyAgreement.PrivateKey(), now: now)
    )
  }

  func testEnforcesTimingWindow() throws {
    let envelope = vectors.envelopes[1].envelope
    let key = try privateKey()
    XCTAssertThrowsError(try openPushEnvelope(envelope, binding: binding, privateKey: key, now: envelope.expiresAt)) {
      XCTAssertEqual($0 as? PushError, .expired)
    }
    XCTAssertThrowsError(
      try openPushEnvelope(envelope, binding: binding, privateKey: key, now: envelope.createdAt - pushMaxClockSkewMs - 1)
    ) { XCTAssertEqual($0 as? PushError, .expired) }
    XCTAssertNoThrow(
      try openPushEnvelope(envelope, binding: binding, privateKey: key, now: envelope.createdAt - pushMaxClockSkewMs)
    )

    let tooLong = try resigned(
      envelope, createdAt: envelope.createdAt, expiresAt: envelope.createdAt + pushMaxLifetimeMs + 1
    )
    XCTAssertThrowsError(try openPushEnvelope(tooLong, binding: binding, privateKey: key, now: now(envelope))) {
      XCTAssertEqual($0 as? PushError, .expired)
    }
  }

  func testStoreDecryptRejectsReplay() throws {
    let ledger = PushReplayLedger(directory: try temporaryDirectory())
    let envelope = vectors.envelopes[2].envelope
    XCTAssertEqual(try store.decrypt(envelope, now: now(envelope), ledger: ledger), vectors.envelopes[2].content)
    XCTAssertThrowsError(try store.decrypt(envelope, now: now(envelope), ledger: ledger)) {
      XCTAssertEqual($0 as? PushError, .replayed)
    }
  }

  func testReplayLedgerForgetsAfterRetention() throws {
    let ledger = PushReplayLedger(directory: try temporaryDirectory())
    let id = UUID().uuidString.lowercased()
    XCTAssertTrue(try ledger.claim(id, now: 1_000))
    XCTAssertFalse(try ledger.claim(id, now: 1_000 + PushReplayLedger.retentionMs - 1))
    XCTAssertTrue(try ledger.claim(id, now: 1_000 + PushReplayLedger.retentionMs))
  }

  func testReplayLedgerEvictsOldestAtCapacity() throws {
    let ledger = PushReplayLedger(directory: try temporaryDirectory(), capacity: 8)
    let ids = (0...8).map { _ in UUID().uuidString.lowercased() }
    for (index, id) in ids.enumerated() {
      XCTAssertTrue(try ledger.claim(id, now: Int64(index)))
    }
    XCTAssertFalse(try ledger.claim(ids.last!, now: Int64(ids.count)))
    XCTAssertTrue(try ledger.claim(ids.first!, now: Int64(ids.count)))
  }

  func testRejectsInvalidPlaintext() {
    XCTAssertThrowsError(try unpadPushPlaintext(Data("{}".utf8)))
    let unpadded = #"{"environmentId":"e","threadId":"t","kind":"approval","title":"T","body":"B","p":""}"#
    XCTAssertThrowsError(try unpadPushPlaintext(Data(unpadded.utf8)))
    let unknownKind = #"{"environmentId":"e","threadId":"t","kind":"other","title":"T","body":"B","p":""}"#
    let padded = unknownKind + String(repeating: " ", count: 256 - unknownKind.utf8.count)
    XCTAssertThrowsError(try unpadPushPlaintext(Data(padded.utf8)))
  }

  func testRejectsNonCanonicalBase64Url() {
    XCTAssertThrowsError(try base64UrlDecode("AA==", maxBytes: 32))
    XCTAssertThrowsError(try base64UrlDecode("AB", maxBytes: 32))
    XCTAssertThrowsError(try base64UrlDecode("A+", maxBytes: 32))
    XCTAssertEqual(try base64UrlDecode("AA", maxBytes: 32), Data([0]))
  }

  func testBindingsLifecycle() throws {
    let key = try store.generateKey()
    XCTAssertTrue(isPushId(key.keyId))
    XCTAssertEqual(try base64UrlDecode(key.publicKey, maxBytes: 32).count, 32)
    XCTAssertEqual(try store.orphanKeyIds(), [key.keyId])

    let registrationId = UUID().uuidString.lowercased()
    let binding = PushBinding(
      registrationId: registrationId, keyId: key.keyId, environmentId: "environment-2", hostKey: vectors.host.publicKey
    )
    try store.saveBinding(binding)
    XCTAssertEqual(try store.orphanKeyIds(), [])
    XCTAssertEqual(try store.bindings().count, 2)
    XCTAssertEqual(try store.binding(registrationId), binding)

    try store.deleteBinding(registrationId)
    XCTAssertEqual(try store.bindings().map(\.registrationId), [vectors.recipient.registrationId])
    XCTAssertThrowsError(try store.privateKey(key.keyId))

    XCTAssertThrowsError(try store.saveBinding(PushBinding(
      registrationId: UUID().uuidString.lowercased(), keyId: UUID().uuidString.lowercased(),
      environmentId: "environment-3", hostKey: vectors.host.publicKey
    )))
  }

  func testInstallationStore() throws {
    let installations = PushInstallationStore(storage: MemoryStorage())
    XCTAssertNil(try installations.load())
    let installation = PushInstallation(
      installationId: "installation", ownerToken: "owner", token: "abcd", topic: "com.supaterm.mobile", environment: "sandbox"
    )
    try installations.save(installation)
    XCTAssertEqual(try installations.load(), installation)
    try installations.clear()
    XCTAssertNil(try installations.load())
  }

  func testPresenterRendersRoutesAndHonorsDeviceToggle() throws {
    let vector = vectors.envelopes[2]
    let payload = try JSONSerialization.jsonObject(with: JSONEncoder().encode(vector.envelope))
    let now = now(vector.envelope)

    let shown = PushPresenter.present(
      userInfo: ["supaterm": payload], store: store,
      ledger: PushReplayLedger(directory: try temporaryDirectory()), hideContent: false, now: now
    )
    XCTAssertEqual(shown.title, vector.content.title)
    XCTAssertEqual(shown.subtitle, vector.content.subtitle ?? "")
    XCTAssertEqual(shown.body, vector.content.body)
    XCTAssertEqual(shown.threadIdentifier, "\(vector.content.environmentId):\(vector.content.threadId)")
    XCTAssertEqual(shown.route, [
      "environmentId": vector.content.environmentId,
      "threadId": vector.content.threadId,
      "kind": vector.content.kind.rawValue,
    ])

    let hidden = PushPresenter.present(
      userInfo: ["supaterm": payload], store: store,
      ledger: PushReplayLedger(directory: try temporaryDirectory()), hideContent: true, now: now
    )
    XCTAssertEqual(hidden.title, pushFallbackTitle)
    XCTAssertEqual(hidden.subtitle, "")
    XCTAssertEqual(hidden.body, vector.content.kind.label)
    XCTAssertEqual(hidden.route, shown.route)

    let ledger = PushReplayLedger(directory: try temporaryDirectory())
    XCTAssertNotEqual(PushPresenter.present(userInfo: ["supaterm": payload], store: store, ledger: ledger, hideContent: false, now: now), .fallback)
    XCTAssertEqual(PushPresenter.present(userInfo: ["supaterm": payload], store: store, ledger: ledger, hideContent: false, now: now), .fallback)
  }

  func testPresenterFallsBack() throws {
    let ledger = PushReplayLedger(directory: try temporaryDirectory())
    XCTAssertEqual(PushPresenter.present(userInfo: [:], store: store, ledger: ledger, hideContent: false, now: 0), .fallback)
    XCTAssertEqual(
      PushPresenter.present(userInfo: ["supaterm": ["v": 1]], store: store, ledger: ledger, hideContent: false, now: 0),
      .fallback
    )
    XCTAssertEqual(
      PushPresenter.present(
        userInfo: ["supaterm": ["v": 1], "supatermChallenge": ["enrollmentId": "e", "code": "c"]],
        store: nil, ledger: nil, hideContent: false, now: 0
      ),
      .challenge
    )
    let vector = vectors.envelopes[0]
    let payload = try JSONSerialization.jsonObject(with: JSONEncoder().encode(vector.envelope))
    XCTAssertEqual(
      PushPresenter.present(userInfo: ["supaterm": payload], store: nil, ledger: ledger, hideContent: false, now: now(vector.envelope)),
      .fallback
    )
  }

  func testConfigurationRequiresExpandedGroups() {
    XCTAssertNil(PushConfiguration(infoDictionary: [:]))
    XCTAssertNil(PushConfiguration(infoDictionary: [
      "SupatermPushKeychainGroup": "$(AppIdentifierPrefix)com.supaterm.mobile.push",
      "SupatermPushAppGroup": "group.com.supaterm.mobile",
    ]))
    let configuration = PushConfiguration(infoDictionary: [
      "SupatermPushKeychainGroup": "TEAM.com.supaterm.mobile.push",
      "SupatermPushAppGroup": "group.com.supaterm.mobile",
    ])
    XCTAssertEqual(configuration?.sharedKeychainGroup, "TEAM.com.supaterm.mobile.push")
    XCTAssertNil(configuration?.appKeychainGroup)
  }

  func testRfc9180Vector() throws {
    let vector = vectors.rfc9180
    let key = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: hex(vector.skRm))
    XCTAssertEqual(key.publicKey.rawRepresentation, hex(vector.pkRm))
    var recipient = try HPKE.Recipient(
      privateKey: key, ciphersuite: .Curve25519_SHA256_ChachaPoly, info: hex(vector.info), encapsulatedKey: hex(vector.enc)
    )
    for encryption in vector.encryptions {
      XCTAssertEqual(try recipient.open(hex(encryption.ct), authenticating: hex(encryption.aad)), hex(encryption.pt))
    }
  }
}
