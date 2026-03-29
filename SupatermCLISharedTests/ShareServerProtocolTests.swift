import Foundation
import SupatermCLIShared
import Testing

@testable import supaterm

struct ShareServerProtocolTests {
  @Test
  func createPaneMessageDecodesExpectedFields() throws {
    let data = Data(
      """
      {
        "type": "create_pane",
        "tabId": "11111111-1111-1111-1111-111111111111",
        "direction": "right",
        "targetPaneId": "22222222-2222-2222-2222-222222222222",
        "command": "echo hi",
        "focus": false
      }
      """.utf8
    )

    let message = try ShareClientMessage(data: data)

    #expect(
      message == .createPane(
        tabId: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
        direction: .right,
        targetPaneId: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!,
        command: "echo hi",
        focus: false
      )
    )
  }

  @Test
  func resizePaneMessageDecodesExpectedFields() throws {
    let data = Data(
      """
      {
        "type": "resize_pane",
        "paneId": "33333333-3333-3333-3333-333333333333",
        "cols": 120,
        "rows": 48
      }
      """.utf8
    )

    let message = try ShareClientMessage(data: data)

    #expect(
      message == .resizePane(
        paneId: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!,
        cols: 120,
        rows: 48
      )
    )
  }
}
