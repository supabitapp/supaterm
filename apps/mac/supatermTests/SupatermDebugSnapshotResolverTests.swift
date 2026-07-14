import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct SupatermDebugSnapshotResolverTests {
  @Test
  func resolveMatchesContextPaneInsideMatchingTab() {
    let windowID = UUID(uuidString: "A08EE31D-A6B3-47AB-AE14-50F93F6A9897")!
    let spaceID = UUID(uuidString: "6B537788-BE46-4D8F-9BA9-D2A60A70B468")!
    let projectID = UUID(uuidString: "54C5083A-1091-4126-8499-F44A70B321F0")!
    let tabID = UUID(uuidString: "B841A963-E06A-4B72-8C53-F496BB944164")!
    let paneID = UUID(uuidString: "51BCF751-312F-43A3-B2D4-138E76618AE2")!
    let context = SupatermCLIContext(windowID: windowID, surfaceID: paneID, tabID: tabID)
    let directoryURL = URL(fileURLWithPath: "/tmp/Project", isDirectory: true)
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
      projects: [
        SupatermAppDebugSnapshot.Project(
          index: 1,
          id: projectID,
          directoryURL: directoryURL,
          isPinned: false,
          tabs: [tab]
        )
      ]
    )
    let window = SupatermAppDebugSnapshot.Window(
      index: 1,
      id: windowID,
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
          projectIndex: 1,
          projectID: projectID,
          projectDirectoryURL: directoryURL,
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
    let windowID = UUID(uuidString: "04EAF22D-BC4E-4691-92B3-E65D758C1D59")!
    let spaceID = UUID(uuidString: "6C6B0B59-B32D-4F5B-B8FD-F6D6D26924B2")!
    let projectID = UUID(uuidString: "54C5083A-1091-4126-8499-F44A70B321F0")!
    let tabID = UUID(uuidString: "9B9391CD-A14D-4FC8-AFA3-03A8E5DBA04A")!
    let context = SupatermCLIContext(
      windowID: windowID,
      surfaceID: UUID(uuidString: "F33B73B2-F253-4AB4-8F2B-6EB11D3D9C3E")!,
      tabID: tabID
    )
    let directoryURL = URL(fileURLWithPath: "/tmp/Project", isDirectory: true)
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
      projects: [
        SupatermAppDebugSnapshot.Project(
          index: 1,
          id: projectID,
          directoryURL: directoryURL,
          isPinned: false,
          tabs: [tab]
        )
      ]
    )
    let window = SupatermAppDebugSnapshot.Window(
      index: 1,
      id: windowID,
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
          projectIndex: 1,
          projectID: projectID,
          projectDirectoryURL: directoryURL,
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

  @Test
  func resolveUsesWindowBeforeSharedTabAndPaneIDs() throws {
    let firstWindowID = UUID()
    let secondWindowID = UUID()
    let tabID = UUID()
    let paneID = UUID()
    let terminalIDs = SnapshotTerminalIDs(tabID: tabID, paneID: paneID)
    let secondDirectoryURL = URL(fileURLWithPath: "/tmp/Second", isDirectory: true)
    let windows = [
      snapshotWindow(
        index: 1,
        id: firstWindowID,
        spaceName: "First",
        directoryURL: URL(fileURLWithPath: "/tmp/First", isDirectory: true),
        terminalIDs: terminalIDs
      ),
      snapshotWindow(
        index: 2,
        id: secondWindowID,
        spaceName: "Second",
        directoryURL: secondDirectoryURL,
        terminalIDs: terminalIDs
      ),
    ]

    let resolution = SupatermDebugSnapshotResolver.resolve(
      windows: windows,
      context: SupatermCLIContext(
        windowID: secondWindowID,
        surfaceID: paneID,
        tabID: tabID
      )
    )
    let target = try #require(resolution.currentTarget)

    #expect(target.windowIndex == 2)
    #expect(target.spaceName == "Second")
    #expect(target.projectDirectoryURL == secondDirectoryURL)
  }

  private func snapshotWindow(
    index: Int,
    id: UUID,
    spaceName: String,
    directoryURL: URL,
    terminalIDs: SnapshotTerminalIDs
  ) -> SupatermAppDebugSnapshot.Window {
    SupatermAppDebugSnapshot.Window(
      index: index,
      id: id,
      isKey: false,
      isVisible: true,
      spaces: [
        SupatermAppDebugSnapshot.Space(
          index: 1,
          id: UUID(),
          name: spaceName,
          isSelected: true,
          projects: [
            SupatermAppDebugSnapshot.Project(
              index: 1,
              id: UUID(),
              directoryURL: directoryURL,
              isPinned: false,
              tabs: [
                SupatermAppDebugSnapshot.Tab(
                  index: 1,
                  id: terminalIDs.tabID,
                  title: "shell",
                  isSelected: true,
                  isPinned: false,
                  isDirty: false,
                  isTitleLocked: false,
                  hasRunningActivity: false,
                  hasBell: false,
                  hasReadOnly: false,
                  hasSecureInput: false,
                  panes: [
                    SupatermAppDebugSnapshot.Pane(
                      index: 1,
                      id: terminalIDs.paneID,
                      isFocused: true,
                      displayTitle: "shell",
                      pwd: directoryURL.path(percentEncoded: false),
                      isReadOnly: false,
                      hasSecureInput: false,
                      bellCount: 0,
                      isRunning: false,
                      progressState: "none",
                      progressValue: nil,
                      needsCloseConfirmation: false,
                      lastCommandExitCode: nil,
                      lastCommandDurationMs: nil,
                      lastChildExitCode: nil,
                      lastChildExitTimeMs: nil
                    )
                  ]
                )
              ]
            )
          ]
        )
      ]
    )
  }

  private struct SnapshotTerminalIDs {
    let tabID: UUID
    let paneID: UUID
  }
}
