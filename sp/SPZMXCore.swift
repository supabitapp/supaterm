import Darwin
import Foundation

@_silgen_name("zmx_core_ensure_session")
private func zmxCoreEnsureSession(_ sessionName: UnsafePointer<CChar>) -> Int32

@_silgen_name("zmx_core_kill_session")
private func zmxCoreKillSession(_ sessionName: UnsafePointer<CChar>) -> Int32

@_silgen_name("zmx_core_attach_session")
private func zmxCoreAttachSession(_ sessionName: UnsafePointer<CChar>) -> Int32

@_silgen_name("zmx_core_socket_path")
private func zmxCoreSocketPath(
  _ sessionName: UnsafePointer<CChar>,
  _ buffer: UnsafeMutablePointer<UInt8>,
  _ bufferLength: Int
) -> Int

enum SPZMXCoreError: Error {
  case attachFailed(Int32)
  case ensureFailed(Int32)
  case killFailed(Int32)
  case socketPathFailed(Int)
}

extension SPZMXCoreError: LocalizedError {
  var errorDescription: String? {
    switch self {
    case .attachFailed(let code):
      return "zmx core failed to attach session (code \(code))."
    case .ensureFailed(let code):
      return "zmx core failed to ensure session (code \(code))."
    case .killFailed(let code):
      return "zmx core failed to kill session (code \(code))."
    case .socketPathFailed(let code):
      return "zmx core failed to resolve socket path (code \(code))."
    }
  }
}

enum SPZMXCore {
  static func attachSession(named sessionName: String) throws {
    let result = sessionName.withCString { zmxCoreAttachSession($0) }
    guard result >= 0 else {
      throw SPZMXCoreError.attachFailed(result)
    }
  }

  static func ensureSession(named sessionName: String) throws {
    let result = sessionName.withCString { zmxCoreEnsureSession($0) }
    guard result >= 0 else {
      throw SPZMXCoreError.ensureFailed(result)
    }
  }

  static func killSession(named sessionName: String) throws {
    let result = sessionName.withCString { zmxCoreKillSession($0) }
    guard result >= 0 else {
      throw SPZMXCoreError.killFailed(result)
    }
  }

  static func socketPath(for sessionName: String) throws -> String {
    var buffer = Array(repeating: UInt8.zero, count: Int(PATH_MAX))
    let length = try sessionName.withCString { sessionName in
      let result = zmxCoreSocketPath(sessionName, &buffer, buffer.count)
      guard result >= 0 else {
        throw SPZMXCoreError.socketPathFailed(result)
      }
      return result
    }

    return String(decoding: buffer.prefix(length), as: UTF8.self)
  }
}
