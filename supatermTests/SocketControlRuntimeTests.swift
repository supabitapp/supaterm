import Darwin
import Foundation
import Testing

@testable import supaterm

struct SocketControlRuntimeTests {
  @Test
  func startRejectsRegularFileAtSocketPath() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let contents = Data("keep".utf8)
    let created = FileManager.default.createFile(atPath: socketURL.path, contents: contents)
    #expect(created)

    let runtime = SocketControlRuntime(pathProvider: { socketURL.path })

    do {
      _ = try await runtime.start()
      Issue.record("Expected start() to reject a non-socket path.")
    } catch let error as SocketControlRuntime.RuntimeError {
      #expect(error == .existingPathIsNotSocket(socketURL.path))
    } catch {
      Issue.record("Unexpected error: \(error)")
    }

    #expect(FileManager.default.fileExists(atPath: socketURL.path))
    #expect(try Data(contentsOf: socketURL) == contents)
  }

  @Test
  func startReusesStaleSocketPath() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    try createStaleSocket(at: socketURL)
    #expect(try existingNodeType(at: socketURL) == mode_t(S_IFSOCK))

    let runtime = SocketControlRuntime(pathProvider: { socketURL.path })
    let resolvedPath = try await runtime.start()

    #expect(resolvedPath == socketURL.path)
    #expect(try existingNodeType(at: socketURL) == mode_t(S_IFSOCK))

    await runtime.stop()
    #expect(!FileManager.default.fileExists(atPath: socketURL.path))
  }
}

private func makeTemporaryDirectory() throws -> URL {
  let rootURL = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
  return rootURL
}

private func existingNodeType(at url: URL) throws -> mode_t {
  var fileStatus = stat()
  let status = url.path.withCString { pointer in
    lstat(pointer, &fileStatus)
  }
  guard status == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  return fileStatus.st_mode & S_IFMT
}

private func createStaleSocket(at url: URL) throws {
  _ = url.path.withCString(unlink)

  let socketDescriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
  guard socketDescriptor >= 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  defer { Darwin.close(socketDescriptor) }

  var address = sockaddr_un()
  memset(&address, 0, MemoryLayout<sockaddr_un>.size)
  address.sun_family = sa_family_t(AF_UNIX)

  let path = url.path
  let maxLength = MemoryLayout.size(ofValue: address.sun_path)
  guard path.utf8.count < maxLength else {
    throw POSIXError(.ENAMETOOLONG)
  }

  path.withCString { pointer in
    withUnsafeMutablePointer(to: &address.sun_path) { pathPointer in
      let buffer = UnsafeMutableRawPointer(pathPointer).assumingMemoryBound(to: CChar.self)
      strncpy(buffer, pointer, maxLength - 1)
    }
  }

  let bindResult = withUnsafePointer(to: &address) { pointer in
    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
      Darwin.bind(socketDescriptor, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
    }
  }
  guard bindResult == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}
