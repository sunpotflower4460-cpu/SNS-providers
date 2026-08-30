#!/usr/bin/env swift
/// macOS-only: render public/icon.svg to 1x truecolor sRGB PNGs.
/// Linux/CI cannot run this. The generated PNGs are committed.
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let svgURL = root.appendingPathComponent("public/icon.svg")
let sizes = [180, 192, 512, 1024]
let fill = CGColor(srgbRed: 7 / 255, green: 16 / 255, blue: 29 / 255, alpha: 1)

guard let source = NSImage(contentsOf: svgURL), source.isValid else {
  FileHandle.standardError.write(Data("Could not load \(svgURL.path)\n".utf8))
  exit(1)
}

guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
  FileHandle.standardError.write(Data("sRGB color space is unavailable\n".utf8))
  exit(1)
}

for size in sizes {
  let pixels = size
  let rect = CGRect(x: 0, y: 0, width: pixels, height: pixels)
  guard let context = CGContext(
    data: nil,
    width: pixels,
    height: pixels,
    bitsPerComponent: 8,
    bytesPerRow: pixels * 4,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
  ) else {
    FileHandle.standardError.write(Data("Could not create \(pixels)px context\n".utf8))
    exit(1)
  }
  context.setFillColor(fill)
  context.fill(rect)

  var proposed = NSRect(x: 0, y: 0, width: pixels, height: pixels)
  guard let cgImage = source.cgImage(forProposedRect: &proposed, context: nil, hints: nil) else {
    FileHandle.standardError.write(Data("Could not rasterize SVG at \(pixels)px\n".utf8))
    exit(1)
  }
  context.interpolationQuality = .high
  context.draw(cgImage, in: rect)

  guard let rendered = context.makeImage() else {
    FileHandle.standardError.write(Data("Could not snapshot \(pixels)px image\n".utf8))
    exit(1)
  }

  let out = root.appendingPathComponent("public/icon-\(size).png")
  guard let destination = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    FileHandle.standardError.write(Data("Could not create PNG destination\n".utf8))
    exit(1)
  }
  CGImageDestinationAddImage(destination, rendered, [
    kCGImagePropertyDPIWidth: 72,
    kCGImagePropertyDPIHeight: 72,
    kCGImageDestinationLossyCompressionQuality: 1,
  ] as CFDictionary)
  guard CGImageDestinationFinalize(destination) else {
    FileHandle.standardError.write(Data("Could not write \(out.path)\n".utf8))
    exit(1)
  }
  FileHandle.standardOutput.write(Data("Wrote \(out.path)\n".utf8))
}
