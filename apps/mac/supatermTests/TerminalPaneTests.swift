import Foundation
import SupatermCLIShared
import SupatermTerminalCore
import Testing

struct TerminalPaneTests {
  @Test
  func paneAndTerminalKeepDistinctIdentitiesAcrossWireRoundTrip() throws {
    let paneID = PaneID()
    let reference = TerminalReference(machineID: MachineID(), terminalID: TerminalID())
    let pane = TerminalPane(id: paneID, terminal: reference)

    let data = try JSONEncoder().encode(pane)
    let decoded = try JSONDecoder().decode(TerminalPane.self, from: data)

    #expect(decoded == pane)
    #expect(decoded.id == paneID)
    #expect(decoded.terminal == reference)
  }
}
