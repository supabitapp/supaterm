import Foundation
import Testing

@testable import SupatermSupport

func temporaryPiHomeDirectory() throws -> URL {
  try FileManager.default.url(
    for: .itemReplacementDirectory,
    in: .userDomainMask,
    appropriateFor: FileManager.default.temporaryDirectory,
    create: true
  )
}

func writePiSettings(
  _ contents: String,
  homeDirectoryURL: URL
) throws {
  let settingsURL = PiSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
  try FileManager.default.createDirectory(
    at: settingsURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try Data(contents.utf8).write(to: settingsURL)
}

func writePiPackageSources(
  _ sources: [String],
  homeDirectoryURL: URL
) throws {
  let data = try JSONSerialization.data(withJSONObject: ["packages": sources])
  let contents = try #require(String(bytes: data, encoding: .utf8))
  try writePiSettings(contents, homeDirectoryURL: homeDirectoryURL)
}

nonisolated func writeInstalledPiPackage(
  version: String,
  homeDirectoryURL: URL
) throws {
  let packageURL =
    homeDirectoryURL
    .appendingPathComponent(".pi/agent/git/github.com/supabitapp/supaterm-skills/package.json")
  try FileManager.default.createDirectory(
    at: packageURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try Data("{\"version\":\"\(version)\"}".utf8).write(to: packageURL)
}

nonisolated func piSettingsObject(homeDirectoryURL: URL) throws -> [String: Any] {
  let data = try Data(
    contentsOf: PiSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL))
  return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

nonisolated func writePiSettingsObject(
  _ settings: [String: Any],
  homeDirectoryURL: URL
) throws {
  let data = try JSONSerialization.data(withJSONObject: settings)
  try data.write(
    to: PiSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL),
    options: .atomic
  )
}

func piPackageSource(_ value: String, homeDirectoryURL: URL) -> PiPackageSource {
  PiPackageSource(value, homeDirectoryURL: homeDirectoryURL)
}

func canonicalPiPackageSource(homeDirectoryURL: URL) -> PiPackageSource {
  piPackageSource(
    PiSettingsInstaller.canonicalPackageSource,
    homeDirectoryURL: homeDirectoryURL
  )
}

nonisolated final class PiInvocationCapture<Value: Sendable>: @unchecked Sendable {
  private let lock = NSLock()
  private var value: [Value] = []
  private var timeoutValue: [TimeInterval] = []
  private var availabilityCheckValue = 0

  func record(_ invocation: Value, timeout: TimeInterval? = nil) {
    lock.withLock {
      value.append(invocation)
      if let timeout {
        timeoutValue.append(timeout)
      }
    }
  }

  func recordAvailabilityCheck() -> Bool {
    lock.withLock {
      availabilityCheckValue += 1
      return true
    }
  }

  var invocations: [Value] {
    lock.withLock { value }
  }

  var timeouts: [TimeInterval] {
    lock.withLock { timeoutValue }
  }

  var availabilityChecks: Int {
    lock.withLock { availabilityCheckValue }
  }
}

typealias PiCommandCapture = PiInvocationCapture<[String]>
typealias PiMutationCapture = PiInvocationCapture<PiPackageMutation>

extension PiInvocationCapture where Value == [String] {
  var commands: [[String]] {
    invocations
  }
}

extension PiInvocationCapture where Value == PiPackageMutation {
  var mutations: [PiPackageMutation] {
    invocations
  }
}

nonisolated final class PiPackageMutationRunner: @unchecked Sendable {
  private let homeDirectoryURL: URL
  private let isAvailable: Bool
  private let lock = NSLock()
  private var availabilityCheckValue = 0
  private var mutationValue: [PiPackageMutation] = []
  private var timeoutValue: [TimeInterval] = []

  init(homeDirectoryURL: URL, isAvailable: Bool = true) {
    self.homeDirectoryURL = homeDirectoryURL
    self.isAvailable = isAvailable
  }

  func checkAvailability() -> Bool {
    lock.withLock {
      availabilityCheckValue += 1
      return isAvailable
    }
  }

  func run(
    _ mutation: PiPackageMutation,
    timeout: TimeInterval
  ) throws -> PiSettingsInstaller.CommandResult {
    lock.lock()
    defer { lock.unlock() }
    mutationValue.append(mutation)
    timeoutValue.append(timeout)
    var settings = try piSettingsObject(homeDirectoryURL: homeDirectoryURL)
    guard var packages = settings["packages"] as? [String] else {
      return PiSettingsInstaller.CommandResult(status: 1)
    }

    switch mutation {
    case .install(let source):
      if let index = packages.firstIndex(where: { packageSource($0).identity == source.identity }) {
        packages[index] = source.installedValue
      } else {
        packages.append(source.installedValue)
      }
      settings["packages"] = packages
      try writePiSettingsObject(settings, homeDirectoryURL: homeDirectoryURL)
      try writeInstalledPiPackage(version: "0.2.0", homeDirectoryURL: homeDirectoryURL)
    case .remove(let source):
      packages.removeAll { packageSource($0).identity == source.identity }
      settings["packages"] = packages
      try writePiSettingsObject(settings, homeDirectoryURL: homeDirectoryURL)
    case .update(let source):
      guard packages.contains(where: { packageSource($0).identity == source.identity }) else {
        return PiSettingsInstaller.CommandResult(status: 1)
      }
      try writeInstalledPiPackage(version: "0.2.0", homeDirectoryURL: homeDirectoryURL)
    }
    return PiSettingsInstaller.CommandResult(status: 0)
  }

  private func packageSource(_ value: String) -> PiPackageSource {
    PiPackageSource(value, homeDirectoryURL: homeDirectoryURL)
  }

  var availabilityChecks: Int {
    lock.withLock { availabilityCheckValue }
  }

  var mutations: [PiPackageMutation] {
    lock.withLock { mutationValue }
  }

  var timeouts: [TimeInterval] {
    lock.withLock { timeoutValue }
  }
}
