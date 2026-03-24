import Foundation
import Testing

struct ShellIntegrationPreferredBinDirTests {
  @Test
  func zshIntegrationResolvesPreferredBinDirectoryAfterRcPathRewrite() throws {
    let rootURL = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let integrationURL = try installGhosttyZshIntegration(at: rootURL)
    let homeURL = rootURL.appendingPathComponent("home", isDirectory: true)
    let userBinURL = homeURL.appendingPathComponent(".local/bin", isDirectory: true)
    let preferredBinURL = rootURL.appendingPathComponent("app/Contents/Resources/bin", isDirectory: true)
    try FileManager.default.createDirectory(at: userBinURL, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: preferredBinURL, withIntermediateDirectories: true)

    try """
    path=("$HOME/.local/bin" $path)
    """.write(
      to: homeURL.appendingPathComponent(".zshrc", isDirectory: false),
      atomically: true,
      encoding: .utf8
    )
    try writeExecutable(
      at: userBinURL.appendingPathComponent("claude", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'USER_CLAUDE\\n'
        """
    )
    try writeExecutable(
      at: preferredBinURL.appendingPathComponent("sp", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'BUNDLED_SP\\n'
        """
    )
    try writeExecutable(
      at: preferredBinURL.appendingPathComponent("claude", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'BUNDLED_CLAUDE\\n'
        """
    )

    let output = try runExecutable(
      at: URL(fileURLWithPath: "/bin/zsh", isDirectory: false),
      arguments: ["-i", "-c", "_ghostty_deferred_init >/dev/null 2>&1; sp; claude"],
      environment: [
        "HOME": homeURL.path,
        "PATH": "/usr/bin:/bin",
        "GHOSTTY_PREFERRED_BIN_DIR": preferredBinURL.path,
        "ZDOTDIR": integrationURL.path,
        "GHOSTTY_ZSH_ZDOTDIR": homeURL.path,
      ]
    )

    #expect(output.contains("BUNDLED_SP"))
    #expect(output.contains("BUNDLED_CLAUDE"))
    #expect(!output.contains("USER_CLAUDE"))
  }

  @Test
  func bashIntegrationResolvesPreferredBinDirectoryAfterRcPathRewrite() throws {
    let rootURL = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let resourcesURL = try installGhosttyBashIntegration(at: rootURL)
    let homeURL = rootURL.appendingPathComponent("home", isDirectory: true)
    let userBinURL = homeURL.appendingPathComponent(".local/bin", isDirectory: true)
    let preferredBinURL = rootURL.appendingPathComponent("app/Contents/Resources/bin", isDirectory: true)
    try FileManager.default.createDirectory(at: userBinURL, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: preferredBinURL, withIntermediateDirectories: true)

    try """
    PATH="$HOME/.local/bin:$PATH"
    source "$GHOSTTY_RESOURCES_DIR/shell-integration/bash/ghostty.bash"
    """.write(
      to: homeURL.appendingPathComponent(".bashrc", isDirectory: false),
      atomically: true,
      encoding: .utf8
    )
    try writeExecutable(
      at: userBinURL.appendingPathComponent("claude", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'USER_CLAUDE\\n'
        """
    )
    try writeExecutable(
      at: preferredBinURL.appendingPathComponent("sp", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'BUNDLED_SP\\n'
        """
    )
    try writeExecutable(
      at: preferredBinURL.appendingPathComponent("claude", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'BUNDLED_CLAUDE\\n'
        """
    )

    let output = try runExecutable(
      at: URL(fileURLWithPath: "/bin/bash", isDirectory: false),
      arguments: [
        "--noprofile",
        "--rcfile",
        homeURL.appendingPathComponent(".bashrc", isDirectory: false).path,
        "-i",
        "-c",
        "sp; claude",
      ],
      environment: [
        "HOME": homeURL.path,
        "PATH": "/usr/bin:/bin",
        "GHOSTTY_PREFERRED_BIN_DIR": preferredBinURL.path,
        "GHOSTTY_RESOURCES_DIR": resourcesURL.path,
      ]
    )

    #expect(output.contains("BUNDLED_SP"))
    #expect(output.contains("BUNDLED_CLAUDE"))
    #expect(!output.contains("USER_CLAUDE"))
  }

  @Test
  func elvishIntegrationResolvesPreferredBinDirectoryAfterRcPathRewrite() throws {
    guard let elvishURL = executableURL(named: "elvish") else { return }

    let rootURL = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let resourcesURL = try installGhosttyElvishIntegration(at: rootURL)
    let homeURL = rootURL.appendingPathComponent("home", isDirectory: true)
    let userBinURL = homeURL.appendingPathComponent(".local/bin", isDirectory: true)
    let preferredBinURL = rootURL.appendingPathComponent("app/Contents/Resources/bin", isDirectory: true)
    let configURL = rootURL.appendingPathComponent("config/elvish", isDirectory: true)
    try FileManager.default.createDirectory(at: userBinURL, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: preferredBinURL, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: configURL, withIntermediateDirectories: true)

    try """
    set paths = [$E:HOME"/.local/bin" $@paths]
    use ghostty-integration
    """.write(
      to: configURL.appendingPathComponent("rc.elv", isDirectory: false),
      atomically: true,
      encoding: .utf8
    )
    try writeExecutable(
      at: userBinURL.appendingPathComponent("claude", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'USER_CLAUDE\\n'
        """
    )
    try writeExecutable(
      at: preferredBinURL.appendingPathComponent("sp", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'BUNDLED_SP\\n'
        """
    )
    try writeExecutable(
      at: preferredBinURL.appendingPathComponent("claude", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'BUNDLED_CLAUDE\\n'
        """
    )

    let output = try runExecutable(
      at: elvishURL,
      arguments: ["-i", "-c", "(external sp); (external claude)"],
      environment: [
        "HOME": homeURL.path,
        "PATH": "/usr/bin:/bin",
        "GHOSTTY_PREFERRED_BIN_DIR": preferredBinURL.path,
        "XDG_CONFIG_HOME": rootURL.appendingPathComponent("config", isDirectory: true).path,
        "XDG_DATA_DIRS": resourcesURL.appendingPathComponent("shell-integration", isDirectory: true).path,
      ]
    )

    #expect(output.contains("BUNDLED_SP"))
    #expect(output.contains("BUNDLED_CLAUDE"))
    #expect(!output.contains("USER_CLAUDE"))
  }

  @Test
  func fishIntegrationResolvesPreferredBinDirectoryAfterRcPathRewrite() throws {
    guard let fishURL = executableURL(named: "fish") else { return }

    let rootURL = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let resourcesURL = try installGhosttyFishIntegration(at: rootURL)
    let homeURL = rootURL.appendingPathComponent("home", isDirectory: true)
    let userBinURL = homeURL.appendingPathComponent(".local/bin", isDirectory: true)
    let preferredBinURL = rootURL.appendingPathComponent("app/Contents/Resources/bin", isDirectory: true)
    let configURL = rootURL.appendingPathComponent("config/fish", isDirectory: true)
    try FileManager.default.createDirectory(at: userBinURL, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: preferredBinURL, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: configURL, withIntermediateDirectories: true)

    try """
    set -gx PATH "$HOME/.local/bin" $PATH
    """.write(
      to: configURL.appendingPathComponent("config.fish", isDirectory: false),
      atomically: true,
      encoding: .utf8
    )
    try writeExecutable(
      at: userBinURL.appendingPathComponent("claude", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'USER_CLAUDE\\n'
        """
    )
    try writeExecutable(
      at: preferredBinURL.appendingPathComponent("sp", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'BUNDLED_SP\\n'
        """
    )
    try writeExecutable(
      at: preferredBinURL.appendingPathComponent("claude", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'BUNDLED_CLAUDE\\n'
        """
    )

    let shellIntegrationURL = resourcesURL.appendingPathComponent("shell-integration", isDirectory: true)
    let output = try runExecutable(
      at: fishURL,
      arguments: ["-i", "-c", "emit fish_prompt; sp; claude"],
      environment: [
        "HOME": homeURL.path,
        "PATH": "/usr/bin:/bin",
        "GHOSTTY_PREFERRED_BIN_DIR": preferredBinURL.path,
        "GHOSTTY_SHELL_INTEGRATION_XDG_DIR": shellIntegrationURL.path,
        "XDG_CONFIG_HOME": rootURL.appendingPathComponent("config", isDirectory: true).path,
        "XDG_DATA_DIRS": shellIntegrationURL.path,
      ]
    )

    #expect(output.contains("BUNDLED_SP"))
    #expect(output.contains("BUNDLED_CLAUDE"))
    #expect(!output.contains("USER_CLAUDE"))
  }
}

private func installGhosttyZshIntegration(at rootURL: URL) throws -> URL {
  let integrationURL = rootURL.appendingPathComponent("integration/zsh", isDirectory: true)
  try FileManager.default.createDirectory(at: integrationURL, withIntermediateDirectories: true)
  let sourceRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("ThirdParty/ghostty/src/shell-integration/zsh", isDirectory: true)
  try FileManager.default.copyItem(
    at: sourceRoot.appendingPathComponent(".zshenv", isDirectory: false),
    to: integrationURL.appendingPathComponent(".zshenv", isDirectory: false)
  )
  try FileManager.default.copyItem(
    at: sourceRoot.appendingPathComponent("ghostty-integration", isDirectory: false),
    to: integrationURL.appendingPathComponent("ghostty-integration", isDirectory: false)
  )
  return integrationURL
}

private func installGhosttyBashIntegration(at rootURL: URL) throws -> URL {
  let resourcesURL = rootURL.appendingPathComponent("resources", isDirectory: true)
  let integrationURL = resourcesURL.appendingPathComponent("shell-integration/bash", isDirectory: true)
  try FileManager.default.createDirectory(at: integrationURL, withIntermediateDirectories: true)
  let sourceURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("ThirdParty/ghostty/src/shell-integration/bash/ghostty.bash", isDirectory: false)
  try FileManager.default.copyItem(
    at: sourceURL,
    to: integrationURL.appendingPathComponent("ghostty.bash", isDirectory: false)
  )
  return resourcesURL
}

private func installGhosttyElvishIntegration(at rootURL: URL) throws -> URL {
  let resourcesURL = rootURL.appendingPathComponent("resources", isDirectory: true)
  let integrationURL = resourcesURL.appendingPathComponent("shell-integration/elvish/lib", isDirectory: true)
  try FileManager.default.createDirectory(at: integrationURL, withIntermediateDirectories: true)
  let sourceURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent(
      "ThirdParty/ghostty/src/shell-integration/elvish/lib/ghostty-integration.elv",
      isDirectory: false
    )
  try FileManager.default.copyItem(
    at: sourceURL,
    to: integrationURL.appendingPathComponent("ghostty-integration.elv", isDirectory: false)
  )
  return resourcesURL
}

private func installGhosttyFishIntegration(at rootURL: URL) throws -> URL {
  let resourcesURL = rootURL.appendingPathComponent("resources", isDirectory: true)
  let integrationURL = resourcesURL.appendingPathComponent("shell-integration/fish/vendor_conf.d", isDirectory: true)
  try FileManager.default.createDirectory(at: integrationURL, withIntermediateDirectories: true)
  let sourceURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent(
      "ThirdParty/ghostty/src/shell-integration/fish/vendor_conf.d/ghostty-shell-integration.fish",
      isDirectory: false
    )
  try FileManager.default.copyItem(
    at: sourceURL,
    to: integrationURL.appendingPathComponent("ghostty-shell-integration.fish", isDirectory: false)
  )
  return resourcesURL
}
