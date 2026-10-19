import Foundation
import CryptoKit

public enum RelayError: Error, CustomStringConvertible {
  case invalid(String)
  public var description: String { switch self { case .invalid(let message): return message } }
}

public struct RelayIdentity {
  static let suffix = ".relay.supaterm.alt"
  static let legacySuffix = ".relay.supaterm.invalid"
  public let key: Data
  public let endpointID: String
  public let address: String
  public var stablePort: UInt16 { 40000 + UInt16(endpointID.prefix(4), radix: 16)! % 20000 }

  public init(address: String) throws {
    guard let url = URLComponents(string: address),
          ["https", "wss"].contains(url.scheme), url.port == nil,
          url.user == nil, url.password == nil, let host = url.host,
          let matched = [Self.suffix, Self.legacySuffix].first(where: { host.hasSuffix($0) }) else {
      throw RelayError.invalid("Invalid relay address")
    }
    let parts = host.dropLast(matched.count).split(separator: ".")
    guard parts.count == 2, parts.allSatisfy({ $0.count == 32 }),
          let key = Data(hex: parts.joined()), key.count == 32 else {
      throw RelayError.invalid("Invalid relay identity")
    }
    self.key = key
    endpointID = Data(SHA256.hash(data: key)).hex
    self.address = "https://\(parts.joined(separator: "."))\(Self.suffix)/"
  }
}

struct RelayHandshake {
  let identity: RelayIdentity
  let ephemeral: Curve25519.KeyAgreement.PrivateKey
  init(identity: RelayIdentity, secret: Data? = nil) throws {
    self.identity = identity
    self.ephemeral = try secret.map { try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: $0) }
      ?? Curve25519.KeyAgreement.PrivateKey()
  }
  var hello: String {
    "{\"type\":\"hello\",\"version\":2,\"key\":\"\(ephemeral.publicKey.rawRepresentation.base64URL)\"}"
  }
  func transcript(host: Data) -> Data {
    Data("supaterm-tunnel-v2\n".utf8) + identity.key + ephemeral.publicKey.rawRepresentation + host
  }
  func finish(_ text: String) throws -> RelayCipher {
    struct Welcome: Decodable { let type: String; let version: Int; let key: String; let signature: String }
    guard text.utf8.count <= 4096, let data = text.data(using: .utf8) else {
      throw RelayError.invalid("Invalid relay handshake")
    }
    let welcome = try JSONDecoder().decode(Welcome.self, from: data)
    guard welcome.type == "welcome", welcome.version == 2,
          let host = Data(base64URL: welcome.key), host.count == 32,
          let signature = Data(base64URL: welcome.signature), signature.count == 64 else {
      throw RelayError.invalid("Invalid relay welcome")
    }
    let context = transcript(host: host)
    let signing = try Curve25519.Signing.PublicKey(rawRepresentation: identity.key)
    guard signing.isValidSignature(signature, for: context) else {
      throw RelayError.invalid("Relay host identity mismatch")
    }
    let shared = try ephemeral.sharedSecretFromKeyAgreement(
      with: Curve25519.KeyAgreement.PublicKey(rawRepresentation: host))
    let keys = shared.hkdfDerivedSymmetricKey(using: SHA256.self,
      salt: Data(SHA256.hash(data: context)), sharedInfo: Data("supaterm-tunnel-traffic-v1".utf8),
      outputByteCount: 64).withUnsafeBytes { Data($0) }
    return RelayCipher(sendKey: SymmetricKey(data: keys.prefix(32)),
                       receiveKey: SymmetricKey(data: keys.suffix(32)))
  }
}

final class RelayCipher {
  let sendKey: SymmetricKey
  let receiveKey: SymmetricKey
  var sent: UInt64 = 0
  var received: UInt64 = 0
  init(sendKey: SymmetricKey, receiveKey: SymmetricKey) {
    self.sendKey = sendKey; self.receiveKey = receiveKey
  }
  func seal(_ plain: Data) throws -> Data {
    guard sent < UInt64.max else { throw RelayError.invalid("Relay sequence exhausted") }
    let sequence = Data(bigEndian: sent)
    let nonce = try ChaChaPoly.Nonce(data: Data(repeating: 0, count: 4) + sequence)
    let box = try ChaChaPoly.seal(plain, using: sendKey, nonce: nonce)
    sent += 1
    return sequence + box.ciphertext + box.tag
  }
  func open(_ record: Data) throws -> Data {
    guard record.count >= 24, record.count <= 65536 + 24,
          record.uint64(at: 0) == received, received < UInt64.max else {
      throw RelayError.invalid("Invalid or out of order relay record")
    }
    let nonce = try ChaChaPoly.Nonce(data: Data(repeating: 0, count: 4) + record.prefix(8))
    let box = try ChaChaPoly.SealedBox(nonce: nonce, ciphertext: record.dropFirst(8).dropLast(16),
                                     tag: record.suffix(16))
    let plain = try ChaChaPoly.open(box, using: receiveKey)
    received += 1
    return plain
  }
}

extension Data {
  init?(hex: String) {
    guard hex.count % 2 == 0 else { return nil }
    var bytes: [UInt8] = []
    var position = hex.startIndex
    while position < hex.endIndex {
      let next = hex.index(position, offsetBy: 2)
      guard let byte = UInt8(hex[position..<next], radix: 16) else { return nil }
      bytes.append(byte); position = next
    }
    self.init(bytes)
  }
  var hex: String { map { String(format: "%02x", $0) }.joined() }
  var base64URL: String { base64EncodedString().replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
  init?(base64URL: String) {
    guard base64URL.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { return nil }
    let text = base64URL.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    self.init(base64Encoded: text + String(repeating: "=", count: (4 - text.count % 4) % 4))
  }
  init<T: FixedWidthInteger>(bigEndian value: T) {
    var value = value.bigEndian
    self = Swift.withUnsafeBytes(of: &value) { Data($0) }
  }
  func uint32(at offset: Int) -> UInt32 {
    (0..<4).reduce(0) { ($0 << 8) | UInt32(self[startIndex + offset + $1]) }
  }
  func uint64(at offset: Int) -> UInt64 {
    (0..<8).reduce(0) { ($0 << 8) | UInt64(self[startIndex + offset + $1]) }
  }
}
