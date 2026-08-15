import Foundation
import SupatermCLIShared
import SupatermTerminalCore
import Testing

@testable import supaterm

struct TerminalPaneTests {
  @Test(arguments: [
    SupatermHostTerminalStatus.starting,
    .running,
    .exiting,
  ])
  func liveTerminalStatusPresentsAsAttaching(_ status: SupatermHostTerminalStatus) {
    #expect(TerminalPanePresentation(status: status) == .attaching)
  }

  @Test
  func terminalStatusPreservesWhyNoViewCanAttach() {
    let exit = SupatermHostProcessExit.signal("TERM")

    #expect(TerminalPanePresentation(status: nil) == .unavailable)
    #expect(TerminalPanePresentation(status: .interrupted) == .interrupted)
    #expect(TerminalPanePresentation(status: .failed(message: "spawn failed")) == .failed("spawn failed"))
    #expect(TerminalPanePresentation(status: .exited(exit)) == .exited(exit))
  }

  @Test
  func terminalPaneTreeUsesPaneIdentityForRepeatedTerminalReferences() throws {
    let terminal = TerminalReference(machineID: MachineID(), terminalID: TerminalID())
    let firstPane = TerminalPane(id: PaneID(), terminal: terminal)
    let secondPane = TerminalPane(id: PaneID(), terminal: terminal)

    let tree = try TerminalPaneTree(view: firstPane)
      .inserting(view: secondPane, at: firstPane, direction: .right)

    #expect(tree.root?.leaves() == [firstPane, secondPane])
  }

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
