import AVFoundation
import AppKit
import CoreVideo
import Foundation
import ImageIO
import SupatermCLIShared

@MainActor
final class ComputerUseRecorder {
  struct Turn {
    let directory: URL
  }

  struct FinishedTurn<Request: Encodable, Result: Encodable> {
    let method: String
    let request: Request
    let result: Result
    let screenshotPath: String?
    let markerPath: String?
  }

  private struct RecordedTurn: Codable {
    let method: String
    let params: JSONObject
    let result: JSONValue
    let screenshotPath: String?
    let markerPath: String?
    let timestamp: Date
  }

  private var activeDirectory: URL?
  private var turnCount = 0

  var isActive: Bool {
    activeDirectory != nil
  }

  var currentDirectoryPath: String? {
    activeDirectory?.path
  }

  func start(directory rawDirectory: String?) throws -> SupatermComputerUseRecordingResult {
    let directory = try recordingDirectory(rawDirectory)
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: nil
    )
    activeDirectory = directory
    turnCount = 0
    try writeSession(to: directory)
    return SupatermComputerUseRecordingResult(active: true, directory: directory.path, turns: 0)
  }

  func stop() -> SupatermComputerUseRecordingResult {
    let directory = activeDirectory
    let turns = turnCount
    activeDirectory = nil
    turnCount = 0
    return SupatermComputerUseRecordingResult(active: false, directory: directory?.path, turns: turns)
  }

  func status() -> SupatermComputerUseRecordingResult {
    SupatermComputerUseRecordingResult(active: isActive, directory: activeDirectory?.path, turns: turnCount)
  }

  func beginTurn() throws -> Turn? {
    guard let activeDirectory else {
      return nil
    }
    turnCount += 1
    let name = "turn-\(String(format: "%04d", turnCount))"
    let directory = activeDirectory.appendingPathComponent(name, isDirectory: true)
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: nil
    )
    return Turn(directory: directory)
  }

  func finishTurn<Request: Encodable, Result: Encodable>(
    _ turn: Turn,
    _ finishedTurn: FinishedTurn<Request, Result>
  ) throws {
    let params = try objectValue(finishedTurn.request)
    let record = RecordedTurn(
      method: finishedTurn.method,
      params: params,
      result: try JSONValue(finishedTurn.result),
      screenshotPath: finishedTurn.screenshotPath,
      markerPath: finishedTurn.markerPath,
      timestamp: Date()
    )
    try encode(record).write(to: turn.directory.appendingPathComponent("action.json"), options: .atomic)
  }

  func recordedRequests(directory rawDirectory: String?) throws -> [SupatermSocketRequest] {
    let directory = try recordingDirectory(rawDirectory ?? activeDirectory?.path)
    let turns = try turnDirectories(in: directory)
    return try turns.enumerated().map { offset, directory in
      let data = try Data(contentsOf: directory.appendingPathComponent("action.json"))
      let record = try JSONDecoder().decode(RecordedTurn.self, from: data)
      return SupatermSocketRequest(
        id: "recording-\(offset + 1)",
        method: record.method,
        params: record.params
      )
    }
  }

  func render(
    directory rawDirectory: String?,
    outputPath rawOutputPath: String?
  ) throws -> SupatermComputerUseRecordingResult {
    let directory = try recordingDirectory(rawDirectory ?? activeDirectory?.path)
    let outputURL = URL(
      fileURLWithPath: NSString(
        string: rawOutputPath ?? directory.appendingPathComponent("recording.mp4").path
      ).expandingTildeInPath
    )
    let images = try turnDirectories(in: directory).compactMap { directory in
      let marker = directory.appendingPathComponent("click.png")
      if FileManager.default.fileExists(atPath: marker.path) {
        return marker
      }
      let screenshot = directory.appendingPathComponent("screenshot.png")
      return FileManager.default.fileExists(atPath: screenshot.path) ? screenshot : nil
    }
    try ComputerUseRecordingVideoRenderer.render(imageURLs: images, outputURL: outputURL)
    return SupatermComputerUseRecordingResult(
      active: isActive,
      directory: directory.path,
      turns: images.count,
      renderedPath: outputURL.path
    )
  }

  private func recordingDirectory(_ rawDirectory: String?) throws -> URL {
    if let rawDirectory, !rawDirectory.isEmpty {
      return URL(fileURLWithPath: NSString(string: rawDirectory).expandingTildeInPath)
    }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withDashSeparatorInDate, .withColonSeparatorInTime]
    let safeName = formatter.string(from: Date()).replacingOccurrences(of: ":", with: "-")
    return SupatermStateRoot.directoryURL()
      .appendingPathComponent("computer-use-recordings", isDirectory: true)
      .appendingPathComponent(safeName, isDirectory: true)
  }

  private func writeSession(to directory: URL) throws {
    let object: JSONObject = [
      "started_at": .string(ISO8601DateFormatter().string(from: Date())),
      "schema": .int(1),
    ]
    try encode(object).write(to: directory.appendingPathComponent("session.json"), options: .atomic)
  }

  private func turnDirectories(in directory: URL) throws -> [URL] {
    try FileManager.default.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: nil
    )
    .filter { $0.lastPathComponent.hasPrefix("turn-") }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }
  }

  private func objectValue<T: Encodable>(_ value: T) throws -> JSONObject {
    let jsonValue = try JSONValue(value)
    guard case .object(let object) = jsonValue else {
      throw SupatermSocketProtocolError.payloadMustBeJSONObject
    }
    return object
  }

  private func encode<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    encoder.dateEncodingStrategy = .iso8601
    return try encoder.encode(value)
  }
}

private enum ComputerUseRecordingVideoRenderer {
  static func render(imageURLs: [URL], outputURL: URL) throws {
    guard let first = imageURLs.first else {
      throw ComputerUseError.imageWriteFailed(outputURL.path)
    }
    let firstImage = try image(at: first)
    let width = firstImage.width
    let height = firstImage.height
    try FileManager.default.createDirectory(
      at: outputURL.deletingLastPathComponent(),
      withIntermediateDirectories: true,
      attributes: nil
    )
    if FileManager.default.fileExists(atPath: outputURL.path) {
      try FileManager.default.removeItem(at: outputURL)
    }
    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    let input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
      ]
    )
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
      ]
    )
    guard writer.canAdd(input) else {
      throw ComputerUseError.imageWriteFailed(outputURL.path)
    }
    writer.add(input)
    guard writer.startWriting() else {
      throw writer.error ?? ComputerUseError.imageWriteFailed(outputURL.path)
    }
    writer.startSession(atSourceTime: .zero)
    for (index, imageURL) in imageURLs.enumerated() {
      while !input.isReadyForMoreMediaData {
        Thread.sleep(forTimeInterval: 0.01)
      }
      let image = try image(at: imageURL)
      let buffer = try pixelBuffer(image: image, width: width, height: height)
      let time = CMTime(value: CMTimeValue(index * 2), timescale: 2)
      guard adaptor.append(buffer, withPresentationTime: time) else {
        throw writer.error ?? ComputerUseError.imageWriteFailed(outputURL.path)
      }
    }
    input.markAsFinished()
    let semaphore = DispatchSemaphore(value: 0)
    writer.finishWriting {
      semaphore.signal()
    }
    semaphore.wait()
    guard writer.status == .completed else {
      throw writer.error ?? ComputerUseError.imageWriteFailed(outputURL.path)
    }
  }

  private static func image(at url: URL) throws -> CGImage {
    guard
      let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
      throw ComputerUseError.imageWriteFailed(url.path)
    }
    return image
  }

  private static func pixelBuffer(image: CGImage, width: Int, height: Int) throws -> CVPixelBuffer {
    var buffer: CVPixelBuffer?
    let status = CVPixelBufferCreate(
      kCFAllocatorDefault,
      width,
      height,
      kCVPixelFormatType_32ARGB,
      nil,
      &buffer
    )
    guard status == kCVReturnSuccess, let buffer else {
      throw ComputerUseError.imageWriteFailed("pixel-buffer")
    }
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard
      let context = CGContext(
        data: CVPixelBufferGetBaseAddress(buffer),
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
      )
    else {
      throw ComputerUseError.imageWriteFailed("pixel-buffer")
    }
    context.setFillColor(NSColor.black.cgColor)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let scale = min(Double(width) / Double(image.width), Double(height) / Double(image.height))
    let drawWidth = Double(image.width) * scale
    let drawHeight = Double(image.height) * scale
    let rect = CGRect(
      x: (Double(width) - drawWidth) / 2,
      y: (Double(height) - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight
    )
    context.draw(image, in: rect)
    return buffer
  }
}
