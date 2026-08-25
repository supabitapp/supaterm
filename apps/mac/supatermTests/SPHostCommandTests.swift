import ArgumentParser
import Foundation
import Testing

@testable import SPCLI

struct SPHostCommandTests {
  @Test
  func parserKeepsInternalConnectionAndCommandArgumentsExact() throws {
    let command = try #require(
      try SP.parseAsRoot([
        "host",
        "attach",
        "--destination",
        "khoi@example.com",
        "--ssh-arguments",
        #"["-p","2222"]"#,
        "--session",
        "spt-session",
        "--command",
        #"["printf","hello world"]"#,
        "--working-directory",
        "/srv/project with spaces",
        "--existing",
        "--",
        "/bin/zsh",
        "-l",
      ]) as? SPHostAttach
    )

    #expect(command.connectionOptions.destination == "khoi@example.com")
    #expect(command.connectionOptions.sshArgumentsJSON == #"["-p","2222"]"#)
    #expect(command.session == "spt-session")
    #expect(command.commandJSON == #"["printf","hello world"]"#)
    #expect(command.workingDirectory == "/srv/project with spaces")
    #expect(command.existing)
    #expect(command.trailingCommand == ["/bin/zsh", "-l"])
  }

  @Test
  func parserAcceptsRemoteSessionDiscovery() throws {
    let command = try #require(
      try SP.parseAsRoot([
        "host",
        "sessions",
        "--destination",
        "build",
        "--ssh-arguments",
        #"["-J","gateway"]"#,
      ]) as? SPHostSessions
    )

    #expect(command.connectionOptions.destination == "build")
    #expect(command.connectionOptions.sshArgumentsJSON == #"["-J","gateway"]"#)
  }

  @Test
  func connectionRejectsInvalidDestinationAndArguments() {
    #expect(throws: ValidationError.self) {
      try SPRemoteHostConnection(destination: "-oProxyCommand=bad", sshArgumentsJSON: "[]")
    }
    #expect(throws: ValidationError.self) {
      try SPRemoteHostConnection(destination: "example.com", sshArgumentsJSON: "not-json")
    }
  }

  @Test
  func platformProbeIgnoresRemoteShellOutput() throws {
    let platform = try SPRemoteSessionHost.parsePlatformProbe(
      "Welcome to the build host\n__SUPATERM_HOST_PLATFORM__Linux aarch64\n"
    )

    #expect(platform.operatingSystem == "Linux")
    #expect(platform.architecture == "aarch64")
  }

  @Test
  func platformProbeRejectsUntaggedOutput() {
    #expect(throws: ValidationError.self) {
      try SPRemoteSessionHost.parsePlatformProbe("Linux\naarch64\n")
    }
  }

  @Test
  func prepareUploadsTheMatchingBundledHost() throws {
    let rootURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let executableURL =
      rootURL
      .appendingPathComponent("Supaterm.app/Contents/MacOS/sp", isDirectory: false)
    let hostURL =
      rootURL
      .appendingPathComponent(
        "Supaterm.app/Contents/Resources/supaterm-host/macos-aarch64/supaterm-host",
        isDirectory: false
      )
    let sshURL = rootURL.appendingPathComponent("bin/ssh", isDirectory: false)
    let captureURL = rootURL.appendingPathComponent("uploaded-host", isDirectory: false)
    try FileManager.default.createDirectory(
      at: hostURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try FileManager.default.createDirectory(
      at: sshURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    let hostData = Data("bundled-host".utf8)
    try hostData.write(to: hostURL)
    try """
    #!/bin/sh
    case "$*" in
      *"__SUPATERM_HOST_PLATFORM__"*)
        printf '__SUPATERM_HOST_PLATFORM__Darwin arm64\n'
        ;;
      *"test -x"*)
        exit 1
        ;;
        *"cat >"*)
          /bin/cat > "$CAPTURE_PATH"
        ;;
      *)
        exit 1
        ;;
    esac
    """.write(to: sshURL, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: hostURL.path)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: sshURL.path)

    let prepared = try SPRemoteSessionHost.prepare(
      connection: SPRemoteHostConnection(destination: "build", sshArgumentsJSON: "[]"),
      executableURL: executableURL,
      environment: [
        "PATH": sshURL.deletingLastPathComponent().path,
        "CAPTURE_PATH": captureURL.path,
      ]
    )

    #expect(prepared.sshExecutablePath == sshURL.path)
    #expect(
      prepared.executablePath.hasPrefix(#""$HOME/.local/share/supaterm/hosts/"#)
    )
    #expect(try Data(contentsOf: captureURL) == hostData)
  }

  @Test
  func shellQuotePreservesSpacesAndSingleQuotes() {
    #expect(SPRemoteSessionHost.shellQuote("alpha beta's") == "'alpha beta'\\''s'")
  }

  @Test
  func attachCommandUsesRemoteShellWhenCommandIsEmpty() {
    #expect(
      SPRemoteSessionHost.attachCommand(
        executablePath: #""$HOME/host""#,
        session: "session one",
        workingDirectory: nil,
        existing: false,
        command: []
      ) == #"exec "$HOME/host" 'attach' 'session one'"#
    )
  }

  @Test
  func attachCommandQuotesWorkingDirectoryAndExactCommand() {
    let expected =
      #"cd -- '/srv/project with spaces' && exec "$HOME/host" 'attach' '--existing' 'session' "#
      + #"'/bin/sh' '-lc' 'printf '\''%s'\'' ready'"#
    #expect(
      SPRemoteSessionHost.attachCommand(
        executablePath: #""$HOME/host""#,
        session: "session",
        workingDirectory: "/srv/project with spaces",
        existing: true,
        command: ["/bin/sh", "-lc", "printf '%s' ready"]
      )
        == expected
    )
  }
}
