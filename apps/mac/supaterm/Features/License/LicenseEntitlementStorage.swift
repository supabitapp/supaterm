import CryptoKit
import Foundation
import Sharing
import SupatermCLIShared

public struct LicenseEntitlementCodec: Sendable {
  private struct Claims: Decodable {
    let v: Int
    let lid: String
    let did: String
    let status: LicenseEntitlement.Status
    let upd: LicenseDay?
    let rev: Int
    let iat: Int64
    let reason: String?
  }

  private let publicKey: Curve25519.Signing.PublicKey

  public init(publicKeyRawRepresentation: Data) throws {
    publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: publicKeyRawRepresentation)
  }

  public func decode(
    token: String,
    expectedDeviceID: String,
    expectedLicenseID: String
  ) -> LicenseEntitlement? {
    let segments = token.split(separator: ".", omittingEmptySubsequences: false)
    guard
      segments.count == 2,
      let payload = decodeBase64URL(segments[0]),
      let signature = decodeBase64URL(segments[1]),
      signature.count == 64,
      publicKey.isValidSignature(signature, for: payload),
      let claims = try? JSONDecoder().decode(Claims.self, from: payload),
      claims.v == 1,
      claims.did == expectedDeviceID,
      claims.lid == expectedLicenseID,
      claims.rev >= 0,
      claims.iat >= 0,
      validClaims(claims)
    else { return nil }

    return LicenseEntitlement(
      licenseID: claims.lid,
      deviceID: claims.did,
      status: claims.status,
      updatesThrough: claims.upd,
      revision: claims.rev,
      issuedAt: claims.iat,
      revocationReason: claims.reason,
      signedToken: token
    )
  }

  public func replacement(
    for current: LicenseEntitlement?,
    token: String,
    expectedDeviceID: String,
    expectedLicenseID: String
  ) -> LicenseEntitlement? {
    guard
      let entitlement = decode(
        token: token,
        expectedDeviceID: expectedDeviceID,
        expectedLicenseID: expectedLicenseID
      )
    else { return current }

    guard
      let current,
      current.licenseID == entitlement.licenseID,
      current.deviceID == entitlement.deviceID,
      current.revision >= entitlement.revision
    else { return entitlement }
    return current
  }

  public func encode(_ entitlement: LicenseEntitlement) throws -> Data {
    guard let token = entitlement.signedToken else {
      throw EncodingError.invalidValue(
        entitlement,
        EncodingError.Context(
          codingPath: [],
          debugDescription: "Unsigned license entitlement"
        )
      )
    }
    return Data(token.utf8)
  }

  private func validClaims(_ claims: Claims) -> Bool {
    switch claims.status {
    case .active:
      return claims.upd != nil && claims.reason == nil
    case .revoked:
      return claims.upd == nil && claims.reason?.isEmpty == false
    case .deactivated, .transferred:
      return claims.upd == nil && claims.reason == nil
    }
  }

  private func decodeBase64URL(_ segment: Substring) -> Data? {
    guard !segment.isEmpty, !segment.contains("=") else { return nil }
    var base64 = segment.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let remainder = base64.utf8.count % 4
    guard remainder != 1 else { return nil }
    if remainder != 0 {
      base64.append(String(repeating: "=", count: 4 - remainder))
    }
    guard let data = Data(base64Encoded: base64) else { return nil }
    let canonical = data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
    return canonical == segment ? data : nil
  }
}

extension SharedKey where Self == FileStorageKey<LicenseEntitlement?>.Default {
  public static func licenseEntitlement(
    codec: LicenseEntitlementCodec,
    expectedDeviceID: String,
    expectedLicenseID: String
  ) -> Self {
    Self[
      .fileStorage(
        SupatermStateRoot.fileURL("license.token"),
        decode: { data in
          guard let token = String(data: data, encoding: .utf8) else { return nil }
          return codec.decode(
            token: token,
            expectedDeviceID: expectedDeviceID,
            expectedLicenseID: expectedLicenseID
          )
        },
        encode: { entitlement in
          guard let entitlement else { return Data() }
          return try codec.encode(entitlement)
        }
      ),
      default: nil
    ]
  }
}
