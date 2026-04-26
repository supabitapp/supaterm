import CoreGraphics
import Darwin
import Foundation
import ObjectiveC

enum ComputerUseSkyLightEventPost {
  private typealias PostToPidFn = @convention(c) (pid_t, CGEvent) -> Void
  private typealias SetAuthMessageFn = @convention(c) (CGEvent, AnyObject) -> Void
  private typealias SetIntFieldFn = @convention(c) (CGEvent, UInt32, Int64) -> Void
  private typealias SetWindowLocationFn = @convention(c) (CGEvent, CGPoint) -> Void
  private typealias FactoryMsgSendFn =
    @convention(c) (
      AnyObject, Selector, UnsafeMutableRawPointer, Int32, UInt32
    ) -> AnyObject?
  private typealias PostEventRecordToFn =
    @convention(c) (
      UnsafeRawPointer, UnsafePointer<UInt8>
    ) -> Int32
  private typealias GetFrontProcessFn = @convention(c) (UnsafeMutableRawPointer) -> Int32
  private typealias GetProcessForPIDFn =
    @convention(c) (
      pid_t, UnsafeMutableRawPointer
    ) -> Int32

  private struct Resolved {
    let postToPid: PostToPidFn
    let setAuthMessage: SetAuthMessageFn
    let msgSendFactory: FactoryMsgSendFn
    let messageClass: AnyClass
    let factorySelector: Selector
  }

  private static let resolved: Resolved? = {
    _ = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY)

    guard
      let postToPid = function("SLEventPostToPid", as: PostToPidFn.self),
      let setAuthMessage = function(
        "SLEventSetAuthenticationMessage", as: SetAuthMessageFn.self),
      let msgSendFactory = function("objc_msgSend", as: FactoryMsgSendFn.self),
      let messageClass = NSClassFromString("SLSEventAuthenticationMessage")
    else {
      return nil
    }

    return .init(
      postToPid: postToPid,
      setAuthMessage: setAuthMessage,
      msgSendFactory: msgSendFactory,
      messageClass: messageClass,
      factorySelector: NSSelectorFromString("messageWithEventRecord:pid:version:")
    )
  }()

  private static let setIntField: SetIntFieldFn? = {
    _ = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY)
    return function("SLEventSetIntegerValueField", as: SetIntFieldFn.self)
  }()

  private static let setWindowLocationFn: SetWindowLocationFn? = {
    _ = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY)
    return function("CGEventSetWindowLocation", as: SetWindowLocationFn.self)
  }()

  private static let postEventRecordToFn: PostEventRecordToFn? = {
    _ = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY)
    return function("SLPSPostEventRecordTo", as: PostEventRecordToFn.self)
  }()

  private static let getFrontProcessFn: GetFrontProcessFn? = {
    _ = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY)
    return function("_SLPSGetFrontProcess", as: GetFrontProcessFn.self)
  }()

  private static let getProcessForPIDFn: GetProcessForPIDFn? = {
    function("GetProcessForPID", as: GetProcessForPIDFn.self)
  }()

  static var isAvailable: Bool {
    resolved != nil
  }

  static var isFocusWithoutRaiseAvailable: Bool {
    getFrontProcessFn != nil && getProcessForPIDFn != nil && postEventRecordToFn != nil
  }

  @discardableResult
  static func postToPid(
    _ pid: pid_t,
    event: CGEvent,
    attachAuthMessage: Bool = true
  ) -> Bool {
    guard let resolved else { return false }
    if attachAuthMessage, let record = extractEventRecord(from: event) {
      if let message = resolved.msgSendFactory(
        resolved.messageClass as AnyObject,
        resolved.factorySelector,
        record,
        pid,
        0
      ) {
        resolved.setAuthMessage(event, message)
      }
    }
    resolved.postToPid(pid, event)
    return true
  }

  @discardableResult
  static func setIntegerField(_ event: CGEvent, field: UInt32, value: Int64) -> Bool {
    guard let setIntField else { return false }
    setIntField(event, field, value)
    return true
  }

  @discardableResult
  static func setWindowLocation(_ event: CGEvent, _ point: CGPoint) -> Bool {
    guard let setWindowLocationFn else { return false }
    setWindowLocationFn(event, point)
    return true
  }

  static func getFrontProcess(_ psnBuffer: UnsafeMutableRawPointer) -> Bool {
    guard let getFrontProcessFn else { return false }
    return getFrontProcessFn(psnBuffer) == 0
  }

  static func getProcessPSN(forPid pid: pid_t, into psnBuffer: UnsafeMutableRawPointer) -> Bool {
    guard let getProcessForPIDFn else { return false }
    return getProcessForPIDFn(pid, psnBuffer) == 0
  }

  @discardableResult
  static func postEventRecordTo(
    psn: UnsafeRawPointer,
    bytes: UnsafePointer<UInt8>
  ) -> Bool {
    guard let postEventRecordToFn else { return false }
    return postEventRecordToFn(psn, bytes) == 0
  }

  private static func function<T>(_ name: String, as type: T.Type) -> T? {
    guard let pointer = dlsym(UnsafeMutableRawPointer(bitPattern: -2), name) else {
      return nil
    }
    return unsafeBitCast(pointer, to: type)
  }

  private static func extractEventRecord(from event: CGEvent) -> UnsafeMutableRawPointer? {
    let base = Unmanaged.passUnretained(event).toOpaque()
    for offset in [24, 32, 16] {
      let slot = base.advanced(by: offset).assumingMemoryBound(to: UnsafeMutableRawPointer?.self)
      if let pointer = slot.pointee {
        return pointer
      }
    }
    return nil
  }
}
