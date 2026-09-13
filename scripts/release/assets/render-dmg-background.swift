// Regenerate on macOS: swift scripts/release/assets/render-dmg-background.swift
import AppKit

let size = NSSize(width: 720, height: 400)
let image = NSImage(size: size)
image.lockFocusFlipped(true)
NSColor(calibratedRed: 0.97, green: 0.97, blue: 0.96, alpha: 1).setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()
func text(_ value: String, _ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ fontSize: CGFloat, _ bold: Bool = false, _ color: NSColor = .labelColor) {
    let font = NSFont.systemFont(ofSize: fontSize, weight: bold ? .semibold : .regular)
    (value as NSString).draw(in: NSRect(x: x, y: y, width: width, height: 60), withAttributes: [.font: font, .foregroundColor: color])
}
let ink = NSColor(calibratedWhite: 0.15, alpha: 1)
let muted = NSColor(calibratedWhite: 0.4, alpha: 1)
// Finder places the app and Applications icons at (205, 75) and (515, 75).
let arrow = NSBezierPath()
arrow.move(to: NSPoint(x: 322, y: 75)); arrow.line(to: NSPoint(x: 398, y: 75))
arrow.move(to: NSPoint(x: 386, y: 65)); arrow.line(to: NSPoint(x: 398, y: 75)); arrow.line(to: NSPoint(x: 386, y: 85))
arrow.lineWidth = 2.5
NSColor(calibratedWhite: 0.6, alpha: 1).setStroke(); arrow.stroke()
NSColor.white.setFill()
NSBezierPath(roundedRect: NSRect(x: 32, y: 178, width: 656, height: 194), xRadius: 14, yRadius: 14).fill()
text("首次打开被 macOS 拦截？", 52, 197, 612, 19, true, ink)
text("此版本尚未经过 Apple 开发者认证与公证。", 52, 231, 612, 15, false, muted)
text("1. 先尝试打开 Amiba，再进入「系统设置 → 隐私与安全性」。", 52, 264, 612, 15, false, ink)
text("2. 向下找到 Amiba 的拦截提示，点击「仍要打开」并确认。", 52, 294, 612, 15, false, ink)
text("仅在确认安装包来自 Amiba 官方发布页时允许打开。", 52, 335, 612, 13, false, muted)
image.unlockFocus()
guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("Cannot render background") }
let output = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("dmg-unsigned.png")
try png.write(to: output)
print(output.path)
// electron-builder combines these into a multi-resolution TIFF for Finder.
let retina = output.deletingLastPathComponent().appendingPathComponent("dmg-unsigned@2x.png")
try png.write(to: retina)
for (url, height, width) in [(output, "400", "720"), (retina, "800", "1440")] {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
    process.arguments = ["-z", height, width, url.path]
    try process.run(); process.waitUntilExit()
    precondition(process.terminationStatus == 0, "Cannot resize background")
}
