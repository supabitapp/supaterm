import Darwin
import Foundation

public enum SupatermHostSocketSecurityError: Error, Equatable, Sendable {
  case invalidURL
  case pathTooLong(String)
  case missing(String)
  case inaccessible(String, Int32)
  case notSocket(String)
  case socketOwner(String, expected: uid_t, actual: uid_t)
  case socketPermissions(String, mode_t)
  case invalidRuntimeRoot(String)
  case runtimeRootOwner(String, expected: uid_t, actual: uid_t)
  case runtimeRootPermissions(String, mode_t)
}

public enum SupatermHostSocketSecurity {
  public static func validate(
    socketURL: URL,
    expectedUserID: uid_t = geteuid()
  ) throws {
    guard socketURL.isFileURL else {
      throw SupatermHostSocketSecurityError.invalidURL
    }
    let path = socketURL.standardizedFileURL.path
    guard path.utf8.count < MemoryLayout.size(ofValue: sockaddr_un().sun_path) else {
      throw SupatermHostSocketSecurityError.pathTooLong(path)
    }

    let runtimeRoot = socketURL.standardizedFileURL.deletingLastPathComponent().path
    let rootStatus = try status(at: runtimeRoot)
    guard rootStatus.st_mode & S_IFMT == S_IFDIR else {
      throw SupatermHostSocketSecurityError.invalidRuntimeRoot(runtimeRoot)
    }
    guard rootStatus.st_uid == expectedUserID else {
      throw SupatermHostSocketSecurityError.runtimeRootOwner(
        runtimeRoot,
        expected: expectedUserID,
        actual: rootStatus.st_uid
      )
    }
    let rootMode = rootStatus.st_mode & 0o777
    guard rootMode == 0o700 else {
      throw SupatermHostSocketSecurityError.runtimeRootPermissions(runtimeRoot, rootMode)
    }

    let socketStatus = try status(at: path)
    guard socketStatus.st_mode & S_IFMT == S_IFSOCK else {
      throw SupatermHostSocketSecurityError.notSocket(path)
    }
    guard socketStatus.st_uid == expectedUserID else {
      throw SupatermHostSocketSecurityError.socketOwner(
        path,
        expected: expectedUserID,
        actual: socketStatus.st_uid
      )
    }
    let socketMode = socketStatus.st_mode & 0o777
    guard socketMode == 0o600 else {
      throw SupatermHostSocketSecurityError.socketPermissions(path, socketMode)
    }
  }

  private static func status(at path: String) throws -> stat {
    var fileStatus = stat()
    let result = path.withCString { lstat($0, &fileStatus) }
    guard result == 0 else {
      if errno == ENOENT {
        throw SupatermHostSocketSecurityError.missing(path)
      }
      throw SupatermHostSocketSecurityError.inaccessible(path, errno)
    }
    return fileStatus
  }
}
