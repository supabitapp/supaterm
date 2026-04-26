import CoreGraphics
import Darwin
import Foundation

enum ComputerUseFocusWithoutRaise {
  @discardableResult
  static func activate(targetPid: pid_t, targetWindowID: CGWindowID) -> Bool {
    guard ComputerUseSkyLightEventPost.isFocusWithoutRaiseAvailable else {
      return false
    }

    var previousPSN = [UInt32](repeating: 0, count: 2)
    var targetPSN = [UInt32](repeating: 0, count: 2)

    let previousOK = previousPSN.withUnsafeMutableBytes { raw in
      ComputerUseSkyLightEventPost.getFrontProcess(raw.baseAddress!)
    }
    guard previousOK else { return false }

    let targetOK = targetPSN.withUnsafeMutableBytes { raw in
      ComputerUseSkyLightEventPost.getProcessPSN(forPid: targetPid, into: raw.baseAddress!)
    }
    guard targetOK else { return false }

    var buffer = [UInt8](repeating: 0, count: 0xF8)
    buffer[0x04] = 0xF8
    buffer[0x08] = 0x0D
    let windowID = UInt32(targetWindowID)
    buffer[0x3C] = UInt8(windowID & 0xFF)
    buffer[0x3D] = UInt8((windowID >> 8) & 0xFF)
    buffer[0x3E] = UInt8((windowID >> 16) & 0xFF)
    buffer[0x3F] = UInt8((windowID >> 24) & 0xFF)

    buffer[0x8A] = 0x02
    let defocusOK = previousPSN.withUnsafeBytes { psnRaw in
      buffer.withUnsafeBufferPointer { bufferPointer in
        ComputerUseSkyLightEventPost.postEventRecordTo(
          psn: psnRaw.baseAddress!,
          bytes: bufferPointer.baseAddress!
        )
      }
    }

    buffer[0x8A] = 0x01
    let focusOK = targetPSN.withUnsafeBytes { psnRaw in
      buffer.withUnsafeBufferPointer { bufferPointer in
        ComputerUseSkyLightEventPost.postEventRecordTo(
          psn: psnRaw.baseAddress!,
          bytes: bufferPointer.baseAddress!
        )
      }
    }

    return defocusOK && focusOK
  }
}
