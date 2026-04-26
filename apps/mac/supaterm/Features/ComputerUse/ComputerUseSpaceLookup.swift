import CoreGraphics
import Darwin
import Foundation

enum ComputerUseSpaceLookup {
  private typealias MainConnectionFn = @convention(c) () -> UInt32
  private typealias ActiveSpaceFn = @convention(c) (Int32) -> UInt64
  private typealias SpacesForWindowsFn = @convention(c) (Int32, Int32, CFArray) -> CFArray?

  private struct Resolved {
    let main: MainConnectionFn
    let active: ActiveSpaceFn
    let spacesForWindows: SpacesForWindowsFn
  }

  private static let resolved: Resolved? = {
    _ = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY)
    let rtldDefault = UnsafeMutableRawPointer(bitPattern: -2)
    guard
      let main = dlsym(rtldDefault, "SLSMainConnectionID"),
      let active = dlsym(rtldDefault, "SLSGetActiveSpace"),
      let spaces = dlsym(rtldDefault, "SLSCopySpacesForWindows")
    else {
      return nil
    }
    return .init(
      main: unsafeBitCast(main, to: MainConnectionFn.self),
      active: unsafeBitCast(active, to: ActiveSpaceFn.self),
      spacesForWindows: unsafeBitCast(spaces, to: SpacesForWindowsFn.self)
    )
  }()

  static func currentSpaceID() -> UInt64? {
    guard let resolved else { return nil }
    return resolved.active(Int32(bitPattern: resolved.main()))
  }

  static func spaceIDs(for windowID: UInt32) -> [UInt64]? {
    guard let resolved else { return nil }
    let connection = Int32(bitPattern: resolved.main())
    let windows = [NSNumber(value: windowID)] as CFArray
    guard let raw = resolved.spacesForWindows(connection, 7, windows) as? [NSNumber] else {
      return nil
    }
    return raw.map(\.uint64Value)
  }
}
