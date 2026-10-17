import AppKit

// Finny Ledger app icon: an "f." receipt on an ink-teal field.
let S: CGFloat = 1024
func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: a)
}

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(S), pixelsHigh: Int(S), bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                           bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
let nsctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = nsctx
let ctx = nsctx.cgContext
let space = CGColorSpaceCreateDeviceRGB()

// Background: ink-teal diagonal gradient + soft mint glow (bottom right).
let bg = CGGradient(colorsSpace: space, colors: [rgb(0x1B5A61), rgb(0x0B2328)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(bg, start: CGPoint(x: S, y: S), end: CGPoint(x: 0, y: 0), options: [])
let glow = CGGradient(colorsSpace: space, colors: [rgb(0x3DDBA5, 0.28), rgb(0x3DDBA5, 0)] as CFArray, locations: [0, 1])!
ctx.drawRadialGradient(glow, startCenter: CGPoint(x: 860, y: 140), startRadius: 0, endCenter: CGPoint(x: 860, y: 140), endRadius: 520, options: [])

// Receipt body with rounded top and scalloped (torn) bottom edge. CG origin is bottom-left.
let w: CGFloat = 540, h: CGFloat = 660, r: CGFloat = 64
let x0 = (S - w) / 2, top = 870.0, bottom = top - h
let receipt = CGMutablePath()
receipt.move(to: CGPoint(x: x0, y: bottom))
receipt.addLine(to: CGPoint(x: x0, y: top - r))
receipt.addArc(center: CGPoint(x: x0 + r, y: top - r), radius: r, startAngle: .pi, endAngle: .pi / 2, clockwise: true)
receipt.addLine(to: CGPoint(x: x0 + w - r, y: top))
receipt.addArc(center: CGPoint(x: x0 + w - r, y: top - r), radius: r, startAngle: .pi / 2, endAngle: 0, clockwise: true)
receipt.addLine(to: CGPoint(x: x0 + w, y: bottom))
let scallops = 6
let step = w / CGFloat(scallops)
for i in (0..<scallops).reversed() {
    let xs = x0 + CGFloat(i) * step
    receipt.addQuadCurve(to: CGPoint(x: xs, y: bottom), control: CGPoint(x: xs + step / 2, y: bottom + 46))
}
receipt.closeSubpath()

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -18), blur: 40, color: rgb(0x000000, 0.35))
ctx.addPath(receipt)
ctx.setFillColor(rgb(0xF5F6F1))
ctx.fillPath()
ctx.restoreGState()

// Lettermark "f" in heavy rounded type, navy ink.
let base = NSFont.systemFont(ofSize: 400, weight: .heavy)
let font = NSFont(descriptor: base.fontDescriptor.withDesign(.rounded)!, size: 400)!
let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor(cgColor: rgb(0x1C2547))!, .kern: -10]
let f = NSAttributedString(string: "f", attributes: attrs)
let fs = f.size()
let fx = x0 + 150, fy = top - fs.height - 50
f.draw(at: CGPoint(x: fx, y: fy))

// Mint full stop sitting on the baseline: "f."
let baseline = fy - font.descender
ctx.setFillColor(rgb(0x12B886))
ctx.fillEllipse(in: CGRect(x: fx + fs.width + 14, y: baseline, width: 74, height: 74))

// Perforation: dashed rule across the receipt.
let perfY = baseline - 50
ctx.setStrokeColor(rgb(0x1C2547, 0.28))
ctx.setLineWidth(9)
ctx.setLineCap(.round)
ctx.setLineDash(phase: 0, lengths: [2, 24])
ctx.move(to: CGPoint(x: x0 + 52, y: perfY))
ctx.addLine(to: CGPoint(x: x0 + w - 52, y: perfY))
ctx.strokePath()
ctx.setLineDash(phase: 0, lengths: [])

// Two ledger lines: label bar + amount bar (the last one in mint).
func bar(_ x: CGFloat, _ y: CGFloat, _ len: CGFloat, _ color: CGColor) {
    ctx.setFillColor(color)
    ctx.addPath(CGPath(roundedRect: CGRect(x: x, y: y, width: len, height: 30), cornerWidth: 15, cornerHeight: 15, transform: nil))
    ctx.fillPath()
}
let l1 = perfY - 64, l2 = l1 - 54
bar(x0 + 60, l1, 210, rgb(0x1C2547, 0.22)); bar(x0 + w - 60 - 120, l1, 120, rgb(0x1C2547, 0.22))
bar(x0 + 60, l2, 150, rgb(0x1C2547, 0.22)); bar(x0 + w - 60 - 170, l2, 170, rgb(0x12B886))

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
