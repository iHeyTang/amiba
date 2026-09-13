// Regenerate on macOS: swift scripts/release/assets/render-dmg-background.swift
import AppKit

let size = NSSize(width: 720, height: 500)
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
text("安装 Amiba", 48, 30, 620, 26, true, ink)
text("将 Amiba 拖入 Applications 文件夹，然后从应用程序中打开。", 48, 72, 640, 16, false, muted)
// Finder places the app and Applications icons at (205, 175) and (515, 175).
let arrow = NSBezierPath()
arrow.move(to: NSPoint(x: 322, y: 175)); arrow.line(to: NSPoint(x: 398, y: 175))
arrow.move(to: NSPoint(x: 386, y: 165)); arrow.line(to: NSPoint(x: 398, y: 175)); arrow.line(to: NSPoint(x: 386, y: 185))
arrow.lineWidth = 2.5
NSColor(calibratedWhite: 0.6, alpha: 1).setStroke(); arrow.stroke()
NSColor.white.setFill()
NSBezierPath(roundedRect: NSRect(x: 32, y: 278, width: 656, height: 194), xRadius: 14, yRadius: 14).fill()
text("首次打开被 macOS 拦截？", 52, 297, 612, 19, true, ink)
text("此版本尚未经过 Apple 开发者认证与公证。", 52, 331, 612, 15, false, muted)
text("1. 先尝试打开 Amiba，再进入「系统设置 → 隐私与安全性」。", 52, 364, 612, 15, false, ink)
text("2. 向下找到 Amiba 的拦截提示，点击「仍要打开」并确认。", 52, 394, 612, 15, false, ink)
text("仅在确认安装包来自 Amiba 官方发布页时允许打开。", 52, 435, 612, 13, false, muted)
image.unlockFocus()
guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("Cannot render background") }
let output = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("dmg-unsigned.png")
try png.write(to: output)
print(output.path)
// electron-builder combines these into a multi-resolution TIFF for Finder.
let retina = output.deletingLastPathComponent().appendingPathComponent("dmg-unsigned@2x.png")
try png.write(to: retina)
for (url, height, width) in [(output, "500", "720"), (retina, "1000", "1440")] {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
    process.arguments = ["-z", height, width, url.path]
    try process.run(); process.waitUntilExit()
    precondition(process.terminationStatus == 0, "Cannot resize background")
}
