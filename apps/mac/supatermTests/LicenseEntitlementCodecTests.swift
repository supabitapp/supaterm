import CryptoKit
import Foundation
import Testing

@testable import SupatermSupport

struct LicenseEntitlementCodecTests {
  @Test
  func compatibilityVectorVerifies() throws {
    let codec = try codec()
    let updatesThrough = try #require(LicenseDay("2027-08-17"))
    let entitlement = try #require(
      codec.decode(
        token: Self.compatibilityToken,
        expectedDeviceID: "device-vector",
        expectedLicenseID: "00112233445566778899aabbccddeeff"
      )
    )

    #expect(entitlement.licenseID == "00112233445566778899aabbccddeeff")
    #expect(entitlement.deviceID == "device-vector")
    #expect(entitlement.status == .active)
    #expect(entitlement.updatesThrough == updatesThrough)
    #expect(entitlement.revision == 4)
    #expect(entitlement.issuedAt == 1_755_400_000)
    #expect(entitlement.revocationReason == nil)
  }

  @Test
  func signedEntitlementRoundTripsWithoutChangingToken() throws {
    let codec = try codec()
    let token = try signedToken(activePayload(revision: 4))
    let entitlement = try #require(
      codec.decode(
        token: token,
        expectedDeviceID: Self.deviceID,
        expectedLicenseID: Self.licenseID
      )
    )

    #expect(codec.encode(entitlement) == Data(token.utf8))
  }

  @Test
  func tokenFileWritesRawSignedToken() throws {
    let token = try signedToken(activePayload(revision: 4))
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let url = directory.appending(path: "license.token")
    let file = LicenseTokenFile(url: url)
    defer { try? FileManager.default.removeItem(at: directory) }

    try file.save(token)

    #expect(try Data(contentsOf: url) == Data(token.utf8))
  }

  @Test
  func badSignatureIsRejected() throws {
    let parts = Self.compatibilityToken.split(separator: ".")
    let signature = try #require(parts.last)
    let first = signature.first == "A" ? "B" : "A"
    let token = "\(parts[0]).\(first)\(signature.dropFirst())"

    #expect(
      try codec().decode(
        token: token,
        expectedDeviceID: "device-vector",
        expectedLicenseID: "00112233445566778899aabbccddeeff"
      ) == nil
    )
  }

  @Test
  func unsignedPayloadIsRejected() throws {
    let token = base64URL(Data(activePayload(revision: 4).utf8))

    #expect(
      try codec().decode(
        token: token,
        expectedDeviceID: Self.deviceID,
        expectedLicenseID: Self.licenseID
      ) == nil
    )
  }

  @Test
  func wrongDeviceIsRejected() throws {
    #expect(
      try codec().decode(
        token: Self.compatibilityToken,
        expectedDeviceID: "another-device",
        expectedLicenseID: "00112233445566778899aabbccddeeff"
      ) == nil
    )
  }

  @Test
  func wrongLicenseIsRejected() throws {
    #expect(
      try codec().decode(
        token: Self.compatibilityToken,
        expectedDeviceID: "device-vector",
        expectedLicenseID: "ffeeddccbbaa99887766554433221100"
      ) == nil
    )
  }

  @Test
  func handEditedPayloadIsRejected() throws {
    let parts = Self.compatibilityToken.split(separator: ".")
    let editedPayload = payload(
      deviceID: "device-vector",
      status: .active,
      updatesThrough: "2028-08-17",
      revision: 4,
      issuedAt: 1_755_400_000
    )
    let token = "\(base64URL(Data(editedPayload.utf8))).\(parts[1])"

    #expect(
      try codec().decode(
        token: token,
        expectedDeviceID: "device-vector",
        expectedLicenseID: "00112233445566778899aabbccddeeff"
      ) == nil
    )
  }

  @Test
  func lowerRevisionIsIgnored() throws {
    let codec = try codec()
    let current = try #require(
      codec.decode(
        token: try signedToken(activePayload(revision: 4)),
        expectedDeviceID: Self.deviceID,
        expectedLicenseID: Self.licenseID
      )
    )

    #expect(
      codec.replacement(
        for: current,
        token: try signedToken(activePayload(revision: 3)),
        expectedDeviceID: Self.deviceID,
        expectedLicenseID: Self.licenseID
      )?.revision == 4
    )
  }

  @Test
  func oldLicenseResponseDoesNotReplaceNewLicense() throws {
    let codec = try codec()
    let newLicenseID = "ffeeddccbbaa99887766554433221100"
    let current = try #require(
      codec.decode(
        token: try signedToken(activePayload(licenseID: newLicenseID, revision: 1)),
        expectedDeviceID: Self.deviceID,
        expectedLicenseID: newLicenseID
      )
    )

    #expect(
      codec.replacement(
        for: current,
        token: try signedToken(activePayload(revision: 9)),
        expectedDeviceID: Self.deviceID,
        expectedLicenseID: Self.licenseID
      ) == current
    )
  }

  @Test
  func signedTombstoneDecodesWithStatus() throws {
    let token = try signedToken(
      payload(status: .revoked, reason: "refund")
    )

    #expect(
      try codec().decode(
        token: token,
        expectedDeviceID: Self.deviceID,
        expectedLicenseID: Self.licenseID
      )?.status == .revoked
    )
  }

  @Test
  func activeEntitlementRequiresUpdateDay() throws {
    let token = try signedToken(payload(status: .active))

    #expect(
      try codec().decode(
        token: token,
        expectedDeviceID: Self.deviceID,
        expectedLicenseID: Self.licenseID
      ) == nil
    )
  }

  @Test
  func tombstoneRejectsUpdateDay() throws {
    let token = try signedToken(
      payload(status: .transferred, updatesThrough: "2027-08-17")
    )

    #expect(
      try codec().decode(
        token: token,
        expectedDeviceID: Self.deviceID,
        expectedLicenseID: Self.licenseID
      ) == nil
    )
  }

  @Test
  func revokedTombstoneRequiresReason() throws {
    let token = try signedToken(payload(status: .revoked))

    #expect(
      try codec().decode(
        token: token,
        expectedDeviceID: Self.deviceID,
        expectedLicenseID: Self.licenseID
      ) == nil
    )
  }

  private static let compatibilityToken =
    "eyJ2IjoxLCJsaWQiOiIwMDExMjIzMzQ0NTU2Njc3ODg5OWFhYmJjY2RkZWVmZiIsImRpZCI6ImRldmljZS12ZWN0"
    + "b3IiLCJzdGF0dXMiOiJhY3RpdmUiLCJ1cGQiOiIyMDI3LTA4LTE3IiwicmV2Ijo0LCJpYXQiOjE3NTU0MDAwMDB9"
    + ".yiQ9tbd-6lnTXv8JqeKIJzmI70WJx67yH84Tc8hO167_jIsRA_MPOBUyokKeTlU5TuaOvAznA-fmonaA676QCA"
  private static let deviceID = "device"
  private static let licenseID = "00112233445566778899aabbccddeeff"

  private func codec() throws -> LicenseEntitlementCodec {
    try LicenseEntitlementCodec(
      publicKeyRawRepresentation: Data([
        0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7,
        0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64, 0x07, 0x3a,
        0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25,
        0xaf, 0x02, 0x1a, 0x68, 0xf7, 0x07, 0x51, 0x1a,
      ])
    )
  }

  private func signedToken(_ payload: String) throws -> String {
    let privateKey = try Curve25519.Signing.PrivateKey(
      rawRepresentation: Data([
        0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60,
        0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4,
        0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19,
        0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60,
      ])
    )
    let payloadData = Data(payload.utf8)
    let signature = try privateKey.signature(for: payloadData)
    return "\(base64URL(payloadData)).\(base64URL(signature))"
  }

  private func activePayload(
    licenseID: String = Self.licenseID,
    revision: Int
  ) -> String {
    payload(
      licenseID: licenseID,
      status: .active,
      updatesThrough: "2027-08-17",
      revision: revision,
      issuedAt: 1_755_400_000
    )
  }

  private func payload(
    licenseID: String = Self.licenseID,
    deviceID: String = Self.deviceID,
    status: LicenseEntitlement.Status,
    updatesThrough: String? = nil,
    reason: String? = nil,
    revision: Int = 5,
    issuedAt: Int64 = 1_755_400_001
  ) -> String {
    var payload =
      #"{"v":1,"lid":"\#(licenseID)","did":"\#(deviceID)","#
      + #""status":"\#(status.rawValue)""#
    if let updatesThrough {
      payload += #","upd":"\#(updatesThrough)""#
    }
    if let reason {
      payload += #","reason":"\#(reason)""#
    }
    return payload + #","rev":\#(revision),"iat":\#(issuedAt)}"#
  }

  private func base64URL(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
