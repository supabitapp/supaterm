import ArgumentParser
import Darwin
import Foundation
import SupatermCLIShared

extension SP {
  struct License: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "license",
      abstract: "Inspect and manage the Supaterm license.",
      discussion: SPHelp.licenseDiscussion,
      subcommands: [
        LicenseStatus.self,
        LicenseActivate.self,
        LicenseDeactivate.self,
        LicenseRefresh.self,
        LicenseBuy.self,
        LicenseRenew.self,
      ]
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runLicenseStatus(options: options)
    }
  }

  struct LicenseStatus: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "status",
      abstract: "Print the current license status.",
      discussion: SPHelp.licenseStatusDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runLicenseStatus(options: options)
    }
  }

  struct LicenseActivate: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "activate",
      abstract: "Activate a license from a hidden prompt or stdin.",
      discussion: SPHelp.licenseActivateDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let key = try readLicenseKey()
      try runLicenseStatus(
        options: options,
        request: { _ in try .licenseActivate(SupatermLicenseActivationRequest(key: key)) }
      )
    }
  }

  struct LicenseDeactivate: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "deactivate",
      abstract: "Deactivate this Mac.",
      discussion: SPHelp.licenseDeactivateDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runLicenseStatus(options: options, request: { _ in .licenseDeactivate() })
    }
  }

  struct LicenseRefresh: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "refresh",
      abstract: "Refresh the signed license entitlement.",
      discussion: SPHelp.licenseRefreshDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runLicenseStatus(options: options, request: { _ in .licenseRefresh() })
    }
  }

  struct LicenseBuy: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "buy",
      abstract: "Open the Supaterm purchase page.",
      discussion: SPHelp.licenseBuyDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runLicenseURL(options: options, request: { _ in .licenseBuy() })
    }
  }

  struct LicenseRenew: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "renew",
      abstract: "Open the license renewal page.",
      discussion: SPHelp.licenseRenewDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runLicenseURL(options: options, request: { _ in .licenseRenew() })
    }
  }
}

private func runLicenseStatus(
  options: SPCommandOptions,
  request: (SPSocketClient) throws -> SupatermSocketRequest = { _ in .licenseStatus() }
) throws {
  try runControlCommand(
    options: options,
    responseTimeout: SupatermLicenseTiming.clientResponseTimeout,
    request: request,
    as: SupatermLicenseStatusResult.self,
    plain: renderLicenseStatusPlain,
    human: renderLicenseStatus
  )
}

private func runLicenseURL(
  options: SPCommandOptions,
  request: (SPSocketClient) throws -> SupatermSocketRequest
) throws {
  try runControlCommand(
    options: options,
    responseTimeout: SupatermLicenseTiming.clientResponseTimeout,
    request: request,
    as: SupatermLicenseURLResult.self,
    plain: { $0.url },
    human: { $0.url }
  )
}

private func renderLicenseStatusPlain(_ status: SupatermLicenseStatusResult) -> String {
  [
    status.mode.rawValue,
    status.updatesThrough ?? "-",
    status.deviceName,
    "\(status.openTabCount)/\(status.freeTabLimit)",
  ].joined(separator: "\t")
}

private func renderLicenseStatus(_ status: SupatermLicenseStatusResult) -> String {
  var lines = ["Mode: \(licenseModeName(status.mode))"]
  if let updatesThrough = status.updatesThrough {
    lines.append("Updates through: \(updatesThrough)")
  }
  lines.append("Device: \(status.deviceName)")
  if status.mode != .paid {
    lines.append("Open tabs: \(status.openTabCount) of \(status.freeTabLimit)")
  }
  if status.mode == .free {
    lines.append("Run `sp license buy` or `sp license activate` to unlock more tabs.")
  }
  return lines.joined(separator: "\n")
}

private func licenseModeName(_ mode: SupatermLicenseMode) -> String {
  switch mode {
  case .expired:
    "Updates ended"
  case .free:
    "Free"
  case .paid:
    "Licensed"
  }
}

func readLicenseKey(
  isInteractive: () -> Bool = stdinIsTTY,
  readPipedInput: () -> Data = { FileHandle.standardInput.readDataToEndOfFile() },
  readInteractiveInput: (String) throws -> String = readHiddenLine
) throws -> String {
  let rawValue: String
  if isInteractive() {
    rawValue = try readInteractiveInput("License key: ")
  } else {
    let data = readPipedInput()
    guard let value = String(data: data, encoding: .utf8) else {
      throw ValidationError("License key must be UTF-8 text.")
    }
    rawValue = value
  }

  let key = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !key.isEmpty else {
    throw ValidationError("Enter your Supaterm license key.")
  }
  guard key.count <= 128 else {
    throw ValidationError("License key is too long.")
  }
  return key
}

private func readHiddenLine(_ prompt: String) throws -> String {
  let descriptor = FileHandle.standardInput.fileDescriptor
  var original = termios()
  guard tcgetattr(descriptor, &original) == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  var hidden = original
  hidden.c_lflag &= ~tcflag_t(ECHO)
  guard tcsetattr(descriptor, TCSAFLUSH, &hidden) == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  FileHandle.standardError.write(Data(prompt.utf8))
  defer {
    _ = tcsetattr(descriptor, TCSAFLUSH, &original)
    FileHandle.standardError.write(Data("\n".utf8))
  }
  guard let value = Swift.readLine() else {
    throw ValidationError("Enter your Supaterm license key.")
  }
  return value
}
