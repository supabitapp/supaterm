import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct SupatermDebugSnapshotResolverTests {
  @Test
  func resolveMatchesContextPaneInsideMatchingTab() {
    let spaceID = UUID(uuidString: "6B537788-BE46-4D8F-9BA9-D2A60A70B468")!
    let tabID = UUID(uuidString: "B841A963-E06A-4B72-8C53-F496BB944164")!
    let paneID = UUID(uuidString: "51BCF751-312F-43A3-B2D4-138E76618AE2")!
    let context = SupatermCLIContext(surfaceID: paneID, tabID: tabID)
    let pane = SupatermAppDebugSnapshot.Pane(
      index: 1,
      id: paneID,
      isFocused: true,
      displayTitle: "shell",
      pwd: "/tmp",
      isReadOnly: false,
      hasSecureInput: false,
      bellCount: 0,
      isRunning: true,
      progressState: "indeterminate",
      progressValue: nil,
      needsCloseConfirmation: false,
      lastCommandExitCode: nil,
      lastCommandDurationMs: nil,
      lastChildExitCode: nil,
      lastChildExitTimeMs: nil
    )
    let tab = SupatermAppDebugSnapshot.Tab(
      index: 1,
      id: tabID,
      title: "shell",
      isSelected: true,
      isPinned: false,
      isDirty: true,
      isTitleLocked: false,
      hasRunningActivity: true,
      hasBell: false,
      hasReadOnly: false,
      hasSecureInput: false,
      panes: [pane]
    )
    let space = SupatermAppDebugSnapshot.Space(
      index: 1,
      id: spaceID,
      name: "A",
      isSelected: true,
      tabs: [tab]
    )
    let window = SupatermAppDebugSnapshot.Window(
      index: 1,
      isKey: true,
      isVisible: true,
      spaces: [space]
    )
    let windows = [window]

    let resolution = SupatermDebugSnapshotResolver.resolve(
      windows: windows,
      context: context
    )

    #expect(resolution.problems.isEmpty)
    #expect(
      resolution.currentTarget
        == SupatermAppDebugSnapshot.CurrentTarget(
          windowIndex: 1,
          spaceIndex: 1,
          spaceID: spaceID,
          spaceName: "A",
          tabIndex: 1,
          tabID: tabID,
          tabTitle: "shell",
          paneIndex: 1,
          paneID: paneID
        )
    )
  }

  @Test
  func resolveReturnsTabContextAndProblemWhenPaneIsMissing() {
    let spaceID = UUID(uuidString: "6C6B0B59-B32D-4F5B-B8FD-F6D6D26924B2")!
    let tabID = UUID(uuidString: "9B9391CD-A14D-4FC8-AFA3-03A8E5DBA04A")!
    let context = SupatermCLIContext(
      surfaceID: UUID(uuidString: "F33B73B2-F253-4AB4-8F2B-6EB11D3D9C3E")!,
      tabID: tabID
    )
    let tab = SupatermAppDebugSnapshot.Tab(
      index: 1,
      id: tabID,
      title: "shell",
      isSelected: true,
      isPinned: false,
      isDirty: false,
      isTitleLocked: false,
      hasRunningActivity: false,
      hasBell: false,
      hasReadOnly: false,
      hasSecureInput: false,
      panes: []
    )
    let space = SupatermAppDebugSnapshot.Space(
      index: 1,
      id: spaceID,
      name: "A",
      isSelected: true,
      tabs: [tab]
    )
    let window = SupatermAppDebugSnapshot.Window(
      index: 1,
      isKey: true,
      isVisible: true,
      spaces: [space]
    )
    let windows = [window]

    let resolution = SupatermDebugSnapshotResolver.resolve(
      windows: windows,
      context: context
    )

    #expect(
      resolution.currentTarget
        == SupatermAppDebugSnapshot.CurrentTarget(
          windowIndex: 1,
          spaceIndex: 1,
          spaceID: spaceID,
          spaceName: "A",
          tabIndex: 1,
          tabID: tabID,
          tabTitle: "shell",
          paneIndex: nil,
          paneID: nil
        )
    )
    #expect(
      resolution.problems
        == ["Context pane \(context.surfaceID.uuidString) was not found in tab \(tabID.uuidString)."]
    )
  }
}
