import Foundation
import SupatermCLIShared
import SupatermTerminalCore
import Testing

struct TerminalIdentifiersTests {
  @Test
  func identifiersPreserveTheirRawValues() {
    let rawValue = UUID()

    #expect(PaneID(rawValue: rawValue).rawValue == rawValue)
    #expect(TerminalID(rawValue: rawValue).rawValue == rawValue)
    #expect(MachineID(rawValue: rawValue).rawValue == rawValue)
    #expect(BootID(rawValue: rawValue).rawValue == rawValue)
    #expect(AttachmentID(rawValue: rawValue).rawValue == rawValue)
    #expect(ClientID(rawValue: rawValue).rawValue == rawValue)
    #expect(HostRequestID(rawValue: rawValue).rawValue == rawValue)
  }

  @Test
  func identifiersUseTheirTypedValueAsIdentity() {
    let paneID = PaneID()
    let terminalID = TerminalID()
    let machineID = MachineID()
    let bootID = BootID()
    let attachmentID = AttachmentID()
    let clientID = ClientID()
    let requestID = HostRequestID()

    #expect(paneID.id == paneID)
    #expect(terminalID.id == terminalID)
    #expect(machineID.id == machineID)
    #expect(bootID.id == bootID)
    #expect(attachmentID.id == attachmentID)
    #expect(clientID.id == clientID)
    #expect(requestID.id == requestID)
  }

  @Test
  func identifiersUseCanonicalWireStrings() throws {
    let rawValue = try #require(UUID(uuidString: "01234567-89AB-CDEF-0123-456789ABCDEF"))
    let encoded = Data(#""01234567-89ab-cdef-0123-456789abcdef""#.utf8)

    try expectWireRoundTrip(PaneID.self, rawValue: rawValue, encoded: encoded)
    try expectWireRoundTrip(TerminalID.self, rawValue: rawValue, encoded: encoded)
    try expectWireRoundTrip(MachineID.self, rawValue: rawValue, encoded: encoded)
    try expectWireRoundTrip(BootID.self, rawValue: rawValue, encoded: encoded)
    try expectWireRoundTrip(AttachmentID.self, rawValue: rawValue, encoded: encoded)
    try expectWireRoundTrip(ClientID.self, rawValue: rawValue, encoded: encoded)
    try expectWireRoundTrip(HostRequestID.self, rawValue: rawValue, encoded: encoded)
  }

  @Test
  func identifiersAcceptUppercaseWireStrings() throws {
    let uppercase = Data(#""01234567-89AB-CDEF-0123-456789ABCDEF""#.utf8)
    let canonical = Data(#""01234567-89ab-cdef-0123-456789abcdef""#.utf8)

    try expectUppercaseInputNormalizes(PaneID.self, uppercase: uppercase, canonical: canonical)
    try expectUppercaseInputNormalizes(TerminalID.self, uppercase: uppercase, canonical: canonical)
    try expectUppercaseInputNormalizes(MachineID.self, uppercase: uppercase, canonical: canonical)
    try expectUppercaseInputNormalizes(BootID.self, uppercase: uppercase, canonical: canonical)
    try expectUppercaseInputNormalizes(
      AttachmentID.self, uppercase: uppercase, canonical: canonical)
    try expectUppercaseInputNormalizes(ClientID.self, uppercase: uppercase, canonical: canonical)
    try expectUppercaseInputNormalizes(
      HostRequestID.self, uppercase: uppercase, canonical: canonical)
  }

  private func expectWireRoundTrip<ID: SupatermUUIDIdentifier>(
    _ type: ID.Type,
    rawValue: UUID,
    encoded: Data
  ) throws {
    let value = ID(rawValue: rawValue)
    #expect(try JSONEncoder().encode(value) == encoded)
    #expect(try JSONDecoder().decode(type, from: encoded) == value)
  }

  private func expectUppercaseInputNormalizes<ID: SupatermUUIDIdentifier>(
    _ type: ID.Type,
    uppercase: Data,
    canonical: Data
  ) throws {
    let value = try JSONDecoder().decode(type, from: uppercase)
    #expect(try JSONEncoder().encode(value) == canonical)
  }
}
