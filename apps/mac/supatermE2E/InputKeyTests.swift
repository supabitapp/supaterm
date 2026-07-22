import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct InputKeyTests {
    @Test(.timeLimit(.minutes(5)))
    func backspaceEditsLine() async throws {
      try await withTestSpace { app, space in
        let marker = "bs-\(space.token)"
        try await app.waitForShellPrompt(space.pane)

        try app.type("echo \(marker)X", into: space.pane)
        try await app.waitForCapture(space.pane, contains: "\(marker)X")
        try app.press(.backspace, in: space.pane)
        try app.type(" > backspace.txt", into: space.pane)
        try app.press(.enter, in: space.pane)

        let file = space.directory.appendingPathComponent("backspace.txt")
        try await app.waitUntil("the shell writes backspace.txt") {
          (try? String(contentsOf: file, encoding: .utf8))?.contains(marker) == true
        }
        #expect(try !String(contentsOf: file, encoding: .utf8).contains("\(marker)X"))
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func ctrlCInterruptsRunningCommand() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)

        try app.type("touch sleep-started.txt; sleep 100\n", into: space.pane)
        let startedFile = space.directory.appendingPathComponent("sleep-started.txt")
        try await app.waitUntil("the sleep command starts") {
          FileManager.default.fileExists(atPath: startedFile.path)
        }
        try app.press(.ctrlC, in: space.pane)

        let marker = "interrupted-\(space.token)"
        try app.type("echo \(marker) > interrupted.txt\n", into: space.pane)
        let file = space.directory.appendingPathComponent("interrupted.txt")
        try await app.waitUntil("the shell runs a command after the interrupt") {
          (try? String(contentsOf: file, encoding: .utf8))?.contains(marker) == true
        }
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func ctrlDClosesShellPane() async throws {
      try await withTestSpace { app, space in
        let split = try makeSplit(app, in: space)
        let splitPane = SupatermPaneTargetRequest(paneID: split.paneID)
        try await app.waitForShellPrompt(splitPane)

        try app.press(.ctrlD, in: splitPane)
        try await app.waitUntil("the exited pane is removed") {
          try app.debugPane(split.paneID) == nil
        }
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func ctrlLClearsVisibleScreen() async throws {
      try await withTestSpace { app, space in
        let marker = "clr-\(space.token)"
        try await app.waitForShellPrompt(space.pane)

        try app.type("echo \(marker)\n", into: space.pane)
        try await app.waitForCapture(space.pane, contains: marker)

        try app.press(.ctrlL, in: space.pane)
        try await app.waitUntil("the visible screen is cleared") {
          try !app.capture(space.pane).contains(marker)
        }
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func ctrlZSuspendsJob() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)

        try app.type("touch suspend-started.txt; sleep 100\n", into: space.pane)
        let startedFile = space.directory.appendingPathComponent("suspend-started.txt")
        try await app.waitUntil("the sleep command starts") {
          FileManager.default.fileExists(atPath: startedFile.path)
        }
        try app.press(.ctrlZ, in: space.pane)
        try await app.waitForCapture(space.pane, contains: "suspended")
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func tabCompletesUniqueFilename() async throws {
      try await withTestSpace { app, space in
        let filename = "complete-\(space.token).txt"
        try await app.waitForShellPrompt(space.pane)

        try app.type("touch \(filename)\n", into: space.pane)
        let file = space.directory.appendingPathComponent(filename)
        try await app.waitUntil("the shell creates the completion target") {
          FileManager.default.fileExists(atPath: file.path)
        }

        try app.type("ls complete-", into: space.pane)
        try app.press(.tab, in: space.pane)
        try await app.waitForCapture(space.pane, contains: filename)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func escapeReachesPty() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)

        try app.type("cat -v\n", into: space.pane)
        try app.press(.escape, in: space.pane)
        try app.press(.enter, in: space.pane)
        try await app.waitForCapture(space.pane, contains: "^[")
        try app.press(.ctrlD, in: space.pane)
      }
    }
  }
}
