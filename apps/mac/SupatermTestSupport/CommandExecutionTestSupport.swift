import Darwin
import Foundation
import SupatermCLIShared

public func writeExecutable(
  at url: URL,
  script: String
) throws {
  try FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try script.write(to: url, atomically: true, encoding: .utf8)
  try setExecutablePermissions(at: url)
}

private func setExecutablePermissions(at url: URL) throws {
  let result = url.path.withCString { pointer in
    chmod(pointer, mode_t(0o755))
  }
  guard result == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}

public func makeCommandExecutionTemporaryDirectory() throws -> URL {
  var template = Array("/tmp/stm.XXXXXX".utf8CString)
  guard let pointer = mkdtemp(&template) else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  let path = SupatermSocketPath.canonicalized(String(cString: pointer)) ?? String(cString: pointer)
  return URL(fileURLWithPath: path, isDirectory: true)
}
