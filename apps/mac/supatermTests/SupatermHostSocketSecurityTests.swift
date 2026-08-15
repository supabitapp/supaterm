import Darwin
import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermHostSocketSecurityTests {
  @Test
  func acceptsOwnerOnlyRuntimeSocket() throws {
    let fixture = try HostSocketSecurityFixture()
    defer { fixture.destroy() }
    let socket = try fixture.bindSocket(mode: 0o600)
    defer { Darwin.close(socket) }

    try SupatermHostSocketSecurity.validate(socketURL: fixture.socketURL)
  }

  @Test
  func rejectsMissingAndNonSocketNodes() throws {
    let fixture = try HostSocketSecurityFixture()
    defer { fixture.destroy() }

    #expect(throws: SupatermHostSocketSecurityError.missing(fixture.socketURL.path)) {
      try SupatermHostSocketSecurity.validate(socketURL: fixture.socketURL)
    }

    try Data().write(to: fixture.socketURL)
    try fixture.setMode(0o600, at: fixture.socketURL)
    #expect(throws: SupatermHostSocketSecurityError.notSocket(fixture.socketURL.path)) {
      try SupatermHostSocketSecurity.validate(socketURL: fixture.socketURL)
    }
  }

  @Test
  func rejectsSymlinkSocketPath() throws {
    let fixture = try HostSocketSecurityFixture()
    defer { fixture.destroy() }
    let target = fixture.root.appendingPathComponent("target")
    try Data().write(to: target)
    try FileManager.default.createSymbolicLink(
      at: fixture.socketURL,
      withDestinationURL: target
    )

    #expect(throws: SupatermHostSocketSecurityError.notSocket(fixture.socketURL.path)) {
      try SupatermHostSocketSecurity.validate(socketURL: fixture.socketURL)
    }
  }

  @Test
  func rejectsSocketWithBroadPermissions() throws {
    let fixture = try HostSocketSecurityFixture()
    defer { fixture.destroy() }
    let socket = try fixture.bindSocket(mode: 0o660)
    defer { Darwin.close(socket) }

    #expect(
      throws: SupatermHostSocketSecurityError.socketPermissions(
        fixture.socketURL.path,
        0o660
      )
    ) {
      try SupatermHostSocketSecurity.validate(socketURL: fixture.socketURL)
    }
  }

  @Test
  func rejectsRuntimeRootWithBroadPermissions() throws {
    let fixture = try HostSocketSecurityFixture()
    defer { fixture.destroy() }
    let socket = try fixture.bindSocket(mode: 0o600)
    defer { Darwin.close(socket) }
    try fixture.setMode(0o750, at: fixture.root)

    #expect(
      throws: SupatermHostSocketSecurityError.runtimeRootPermissions(
        fixture.root.path,
        0o750
      )
    ) {
      try SupatermHostSocketSecurity.validate(socketURL: fixture.socketURL)
    }
  }

  @Test
  func rejectsWrongOwnerExpectation() throws {
    let fixture = try HostSocketSecurityFixture()
    defer { fixture.destroy() }
    let socket = try fixture.bindSocket(mode: 0o600)
    defer { Darwin.close(socket) }
    let expectedUserID = geteuid() &+ 1

    #expect(
      throws: SupatermHostSocketSecurityError.runtimeRootOwner(
        fixture.root.path,
        expected: expectedUserID,
        actual: geteuid()
      )
    ) {
      try SupatermHostSocketSecurity.validate(
        socketURL: fixture.socketURL,
        expectedUserID: expectedUserID
      )
    }
  }

  @Test
  func rejectsNonFileAndOversizePaths() {
    #expect(throws: SupatermHostSocketSecurityError.invalidURL) {
      try SupatermHostSocketSecurity.validate(
        socketURL: try #require(URL(string: "https://supaterm.local/host.sock"))
      )
    }

    let path = "/tmp/" + String(repeating: "x", count: 256)
    #expect(throws: SupatermHostSocketSecurityError.pathTooLong(path)) {
      try SupatermHostSocketSecurity.validate(socketURL: URL(fileURLWithPath: path))
    }
  }
}

private struct HostSocketSecurityFixture {
  let root: URL
  let socketURL: URL

  init() throws {
    let identifier = UUID().uuidString.prefix(8)
    root = FileManager.default.temporaryDirectory
      .appendingPathComponent("sth-security-\(identifier)", isDirectory: true)
    socketURL = root.appendingPathComponent("host.sock")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    try setMode(0o700, at: root)
  }

  func bindSocket(mode: mode_t) throws -> Int32 {
    let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard descriptor >= 0 else {
      throw HostSocketSecurityFixtureError.system(errno)
    }
    do {
      var address = sockaddr_un()
      address.sun_family = sa_family_t(AF_UNIX)
      let path = socketURL.path
      let capacity = MemoryLayout.size(ofValue: address.sun_path)
      guard path.utf8.count < capacity else {
        throw HostSocketSecurityFixtureError.pathLength
      }
      _ = path.withCString { source in
        withUnsafeMutablePointer(to: &address.sun_path) { destination in
          strncpy(
            UnsafeMutableRawPointer(destination).assumingMemoryBound(to: CChar.self),
            source,
            capacity - 1
          )
        }
      }
      var mutableAddress = address
      let bindResult = withUnsafePointer(to: &mutableAddress) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
          Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
      }
      guard bindResult == 0, Darwin.listen(descriptor, 1) == 0 else {
        throw HostSocketSecurityFixtureError.system(errno)
      }
      try setMode(mode, at: socketURL)
      return descriptor
    } catch {
      Darwin.close(descriptor)
      throw error
    }
  }

  func setMode(_ mode: mode_t, at url: URL) throws {
    guard chmod(url.path, mode) == 0 else {
      throw HostSocketSecurityFixtureError.system(errno)
    }
  }

  func destroy() {
    try? FileManager.default.removeItem(at: root)
  }
}

private enum HostSocketSecurityFixtureError: Error {
  case pathLength
  case system(Int32)
}
