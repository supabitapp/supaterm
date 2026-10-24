import CryptoKit
import Foundation

public let pushHpkeInfo = Data("supaterm-push-hpke-v1".utf8)
public let pushMaxClockSkewMs: Int64 = 300_000
public let pushMaxLifetimeMs: Int64 = 86_400_000
public let pushPlaintextSizes = [256, 512, 1024]
public let pushFallbackTitle = "Supaterm"

public enum PushError: Error, Equatable {
  case invalidEnvelope
  case unknownRegistration
  case invalidSignature
  case expired
  case replayed
  case invalidContent
  case invalidKey
  case storage
}

public enum PushKind: String, Codable, CaseIterable, Sendable {
  case approval
  case input
  case completion
  case failure
  case usageLimit = "usage-limit"

  public var label: String {
    switch self {
    case .approval: "Approval needed"
    case .input: "Input needed"
    case .completion: "Finished"
    case .failure: "Failed"
    case .usageLimit: "Usage limit reached"
    }
  }
}

public struct PushEnvelope: Codable, Equatable, Sendable {
  public let v: Int
  public let registrationId: String
  public let keyId: String
  public let notificationId: String
  public let createdAt: Int64
  public let expiresAt: Int64
  public let enc: String
  public let ciphertext: String
  public let signature: String

  public var associatedData: String {
    [
      "supaterm-push-v1", String(v), registrationId, keyId, notificationId,
      String(createdAt), String(expiresAt),
    ].joined(separator: "\n")
  }

  public var signatureData: String {
    "supaterm-push-signature-v1\n\(associatedData)\n\(enc)\n\(ciphertext)"
  }
}

public struct PushContent: Codable, Equatable, Sendable {
  public let environmentId: String
  public let threadId: String
  public let kind: PushKind
  public let title: String
  public let subtitle: String?
  public let body: String
}

public struct PushBinding: Codable, Equatable, Sendable {
  public let registrationId: String
  public let keyId: String
  public let environmentId: String
  public let hostKey: String

  public init(registrationId: String, keyId: String, environmentId: String, hostKey: String) {
    self.registrationId = registrationId
    self.keyId = keyId
    self.environmentId = environmentId
    self.hostKey = hostKey
  }
}

public func isPushId(_ value: String) -> Bool {
  value.range(
    of: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    options: .regularExpression
  ) != nil
}

public func base64UrlEncode(_ value: Data) -> String {
  value.base64EncodedString()
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

/// Accepts only canonical unpadded base64url, so one byte string has one spelling.
public func base64UrlDecode(_ value: String, maxBytes: Int) throws -> Data {
  guard !value.isEmpty, value.count <= (maxBytes * 4 + 2) / 3,
        value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
  else { throw PushError.invalidEnvelope }
  let padded = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    + String(repeating: "=", count: (4 - value.count % 4) % 4)
  guard let data = Data(base64Encoded: padded), data.count <= maxBytes,
        base64UrlEncode(data) == value
  else { throw PushError.invalidEnvelope }
  return data
}

private func exactBytes(_ value: String, count: Int) throws -> Data {
  let data = try base64UrlDecode(value, maxBytes: count)
  guard data.count == count else { throw PushError.invalidEnvelope }
  return data
}

private func utf8Count(_ value: String?) -> Int { value?.utf8.count ?? 0 }

/// Verifies, decrypts, and unpads one envelope. Replay is the caller's job, after this succeeds.
public func openPushEnvelope(
  _ envelope: PushEnvelope,
  binding: PushBinding,
  privateKey: Curve25519.KeyAgreement.PrivateKey,
  now: Int64
) throws -> PushContent {
  guard envelope.v == 1, isPushId(envelope.registrationId), isPushId(envelope.keyId),
        isPushId(envelope.notificationId)
  else { throw PushError.invalidEnvelope }
  guard binding.registrationId == envelope.registrationId, binding.keyId == envelope.keyId
  else { throw PushError.unknownRegistration }

  let hostKey = try Curve25519.Signing.PublicKey(rawRepresentation: exactBytes(binding.hostKey, count: 32))
  let signature = try exactBytes(envelope.signature, count: 64)
  guard hostKey.isValidSignature(signature, for: Data(envelope.signatureData.utf8))
  else { throw PushError.invalidSignature }

  guard envelope.createdAt >= 0, envelope.createdAt <= now + pushMaxClockSkewMs,
        envelope.expiresAt > now, envelope.expiresAt > envelope.createdAt,
        envelope.expiresAt - envelope.createdAt <= pushMaxLifetimeMs
  else { throw PushError.expired }

  let encapsulated = try exactBytes(envelope.enc, count: 32)
  let ciphertext = try base64UrlDecode(envelope.ciphertext, maxBytes: pushPlaintextSizes.last! + 16)
  var recipient = try HPKE.Recipient(
    privateKey: privateKey,
    ciphersuite: .Curve25519_SHA256_ChachaPoly,
    info: pushHpkeInfo,
    encapsulatedKey: encapsulated
  )
  let plaintext = try recipient.open(ciphertext, authenticating: Data(envelope.associatedData.utf8))
  let content = try unpadPushPlaintext(plaintext)
  guard content.environmentId == binding.environmentId else { throw PushError.invalidContent }
  return content
}

public func unpadPushPlaintext(_ plaintext: Data) throws -> PushContent {
  guard pushPlaintextSizes.contains(plaintext.count) else { throw PushError.invalidContent }
  let content: PushContent
  do {
    content = try JSONDecoder().decode(PushContent.self, from: plaintext)
  } catch {
    throw PushError.invalidContent
  }
  guard utf8Count(content.environmentId) <= 256, utf8Count(content.threadId) <= 256,
        !content.title.isEmpty, utf8Count(content.title) <= 120,
        utf8Count(content.subtitle) <= 80, utf8Count(content.body) <= 400
  else { throw PushError.invalidContent }
  return content
}
