import Darwin
import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermStateRootTests {
  @Test
  func directoryURLFallsBackToSupatermConfigUnderHome() {
    #expect(
      SupatermStateRoot.directoryURL(
        homeDirectoryPath: "/tmp/khoi",
        environment: [:]
      )
        == URL(fileURLWithPath: "/tmp/khoi", isDirectory: true)
        .appendingPathComponent(".config", isDirectory: true)
        .appendingPathComponent("supaterm", isDirectory: true)
    )
  }

  @Test
  func directoryURLUsesStateHomeWhenPresent() {
    #expect(
      SupatermStateRoot.directoryURL(
        homeDirectoryPath: "/tmp/ignored",
        environment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-dev"]
      )
        == URL(fileURLWithPath: "/tmp/supaterm-dev", isDirectory: true)
        .standardizedFileURL
    )
  }

  @Test
  func fileURLAppendsNameToResolvedDirectory() {
    #expect(
      SupatermStateRoot.fileURL(
        "settings.toml",
        homeDirectoryPath: "/tmp/ignored",
        environment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-dev"]
      )
        == URL(fileURLWithPath: "/tmp/supaterm-dev", isDirectory: true)
        .appendingPathComponent("settings.toml", isDirectory: false)
        .standardizedFileURL
    )
  }

  @Test
  func hostPathsUseXDGForTheExactRustGolden() throws {
    let paths = try SupatermHostPaths(
      environment: [
        SupatermCLIEnvironment.stateHomeKey: "/tmp/state",
        "XDG_RUNTIME_DIR": "/tmp",
      ],
      userID: 501
    )

    #expect(paths.stateRoot.path == "/tmp/state")
    #expect(paths.runtimeRoot.path == "/private/tmp/supaterm/host-499762b5a20ea6ab")
    #expect(paths.socket.path == "/private/tmp/supaterm/host-499762b5a20ea6ab/host.sock")
  }

  @Test
  func hostPathsSkipLongXDGForTMPDIR() throws {
    let paths = try SupatermHostPaths(
      environment: [
        SupatermCLIEnvironment.stateHomeKey: "/tmp/state",
        "TMPDIR": "/var/tmp",
        "XDG_RUNTIME_DIR": "/" + String(repeating: "a", count: 100),
      ],
      userID: 501
    )

    #expect(paths.runtimeRoot.path == "/private/var/tmp/supaterm-501/host-499762b5a20ea6ab")
    #expect(paths.socket.path == "/private/var/tmp/supaterm-501/host-499762b5a20ea6ab/host.sock")
  }

  @Test
  func hostPathsSkipLongXDGAndTMPDIRForPrivateTMP() throws {
    let paths = try SupatermHostPaths(
      environment: [
        SupatermCLIEnvironment.stateHomeKey: "/tmp/state",
        "TMPDIR": "/" + String(repeating: "b", count: 100),
        "XDG_RUNTIME_DIR": "/" + String(repeating: "a", count: 100),
      ],
      userID: 501
    )

    #expect(paths.runtimeRoot.path == "/private/tmp/supaterm-501/host-499762b5a20ea6ab")
    #expect(paths.socket.path == "/private/tmp/supaterm-501/host-499762b5a20ea6ab/host.sock")
  }

  @Test
  func hostPathsMeasureTheExactMultibyteSocketBoundary() throws {
    let fittingXDG = "/a" + String(repeating: "é", count: 30)
    let exactBoundaryXDG = "/" + String(repeating: "é", count: 31)
    let fitting = try SupatermHostPaths(
      environment: [
        SupatermCLIEnvironment.stateHomeKey: "/tmp/state",
        "TMPDIR": "/var/tmp",
        "XDG_RUNTIME_DIR": fittingXDG,
      ],
      userID: 501
    )
    let exactBoundary = try SupatermHostPaths(
      environment: [
        SupatermCLIEnvironment.stateHomeKey: "/tmp/state",
        "TMPDIR": "/var/tmp",
        "XDG_RUNTIME_DIR": exactBoundaryXDG,
      ],
      userID: 501
    )
    let exactBoundarySocket =
      "\(exactBoundaryXDG)/supaterm/host-499762b5a20ea6ab/host.sock"
    let socketPathCapacity = MemoryLayout.size(ofValue: sockaddr_un().sun_path)

    #expect(
      fitting.runtimeRoot.path
        == "\(fittingXDG)/supaterm/host-499762b5a20ea6ab"
    )
    #expect(fitting.socket.path.utf8.count == socketPathCapacity - 1)
    #expect(exactBoundarySocket.utf8.count == socketPathCapacity)
    #expect(
      exactBoundary.socket.path
        == "/private/var/tmp/supaterm-501/host-499762b5a20ea6ab/host.sock"
    )
  }

  @Test
  func hostPathsCanonicalizeAnExistingSymlinkPrefix() throws {
    let fileManager = FileManager.default
    let fixtureName = "sph-\(UUID().uuidString.prefix(8).lowercased())"
    let fixtureRoot = URL(
      fileURLWithPath: "/private/tmp/\(fixtureName)",
      isDirectory: true
    )
    let realDirectory = fixtureRoot.appendingPathComponent("real", isDirectory: true)
    let symlink = fixtureRoot.appendingPathComponent("alias", isDirectory: true)
    try fileManager.createDirectory(at: realDirectory, withIntermediateDirectories: true)
    defer { try? fileManager.removeItem(at: fixtureRoot) }
    try fileManager.createSymbolicLink(
      atPath: symlink.path,
      withDestinationPath: realDirectory.path
    )
    let paths = try SupatermHostPaths(
      environment: [
        SupatermCLIEnvironment.stateHomeKey: "/tmp/state",
        "XDG_RUNTIME_DIR": symlink.appendingPathComponent("pending").path,
      ],
      userID: 501
    )

    #expect(
      paths.runtimeRoot.path
        == "\(realDirectory.path)/pending/supaterm/host-499762b5a20ea6ab"
    )
    #expect(
      paths.socket.path
        == "\(realDirectory.path)/pending/supaterm/host-499762b5a20ea6ab/host.sock"
    )
  }

  @Test
  func hostPathsStandardizeStateRootsBeforeHashing() throws {
    let first = try SupatermHostPaths(
      environment: [
        SupatermCLIEnvironment.instanceNameKey: "first",
        SupatermCLIEnvironment.stateHomeKey: "/tmp/project/../café",
        "XDG_RUNTIME_DIR": "/tmp",
      ],
      userID: 501
    )
    let second = try SupatermHostPaths(
      environment: [
        SupatermCLIEnvironment.instanceNameKey: "second",
        SupatermCLIEnvironment.stateHomeKey: "/tmp/café",
        "XDG_RUNTIME_DIR": "/tmp",
      ],
      userID: 501
    )

    #expect(first == second)
    #expect(Array(first.stateRoot.path.utf8) == Array("/tmp/café".utf8))
    #expect(first.socket.path == "/private/tmp/supaterm/host-0873cca0bdcc4a24/host.sock")
  }

  @Test
  func hostPathsRequireHomeWhenStateResolutionNeedsIt() {
    let homeValues: [String?] = [nil, "", " \n "]
    let stateHomeValues: [String?] = [nil, "~", "~/state"]

    for home in homeValues {
      for stateHome in stateHomeValues {
        var environment = ["XDG_RUNTIME_DIR": "/tmp"]
        environment["HOME"] = home
        environment[SupatermCLIEnvironment.stateHomeKey] = stateHome

        #expect(throws: SupatermHostPathsError.homeDirectoryNotSet) {
          try SupatermHostPaths(environment: environment, userID: 501)
        }
      }
    }
  }

  @Test
  func hostPathsResolveNonTildeStateHomesWithoutHome() throws {
    let absolute = try SupatermHostPaths(
      environment: [
        "HOME": " \n ",
        SupatermCLIEnvironment.stateHomeKey: "/tmp/project/../state",
        "XDG_RUNTIME_DIR": "/tmp",
      ],
      userID: 501
    )
    let relative = try SupatermHostPaths(
      environment: [
        SupatermCLIEnvironment.stateHomeKey: "relative/project/../state",
        "XDG_RUNTIME_DIR": "/tmp",
      ],
      userID: 501
    )
    let namedHome = try SupatermHostPaths(
      environment: [
        SupatermCLIEnvironment.stateHomeKey: "~someone/state",
        "XDG_RUNTIME_DIR": "/tmp",
      ],
      userID: 501
    )
    let currentDirectoryPath = FileManager.default.currentDirectoryPath

    #expect(absolute.stateRoot.path == "/tmp/state")
    #expect(relative.stateRoot.path == "\(currentDirectoryPath)/relative/state")
    #expect(namedHome.stateRoot.path == "\(currentDirectoryPath)/~someone/state")
  }

  @Test
  func hostPathsUseEnvironmentHomeForTheDefaultStateRoot() throws {
    let paths = try SupatermHostPaths(
      environment: [
        "HOME": " /tmp/custom-home ",
        "XDG_RUNTIME_DIR": "/tmp",
      ],
      userID: 501
    )

    #expect(paths.stateRoot.path == "/tmp/custom-home/.config/supaterm")
    #expect(paths.socket.path == "/private/tmp/supaterm/host-7b1ef900787802d8/host.sock")
  }

  @Test
  func hostPathsPreferAnExplicitHomeDirectory() throws {
    let paths = try SupatermHostPaths(
      homeDirectoryPath: "/tmp/explicit",
      environment: [
        "HOME": "/tmp/environment",
        "XDG_RUNTIME_DIR": "/tmp",
      ],
      userID: 501
    )

    #expect(paths.stateRoot.path == "/tmp/explicit/.config/supaterm")
    #expect(paths.socket.path == "/private/tmp/supaterm/host-04c0927cd24937e5/host.sock")
  }

  @Test
  func hostPathsRejectABlankExplicitHomeDirectory() {
    #expect(throws: SupatermHostPathsError.homeDirectoryNotSet) {
      try SupatermHostPaths(
        homeDirectoryPath: " \n ",
        environment: [
          "HOME": "/tmp/environment",
          "XDG_RUNTIME_DIR": "/tmp",
        ],
        userID: 501
      )
    }
  }

  @Test
  func hostPathsExpandCurrentHomeBeforeStandardizing() throws {
    let paths = try SupatermHostPaths(
      environment: [
        "HOME": "/tmp/home",
        SupatermCLIEnvironment.stateHomeKey: "~/project/../state",
        "XDG_RUNTIME_DIR": "/tmp",
      ],
      userID: 501
    )

    #expect(paths.stateRoot.path == "/tmp/home/state")
    #expect(paths.socket.path == "/private/tmp/supaterm/host-8fef48cdbbc43362/host.sock")
  }
}
