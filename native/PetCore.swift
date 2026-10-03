import Foundation
import CoreGraphics

struct PetDrag {
    private var start: CGPoint?
    private var origin = CGPoint.zero
    private var previous = CGPoint.zero
    private(set) var moved = false
    private(set) var direction = "running-right"

    mutating func begin(pointer: CGPoint, origin: CGPoint) {
        start = pointer; previous = pointer; self.origin = origin; moved = false
    }
    mutating func move(pointer: CGPoint) -> CGPoint? {
        guard let start else { return nil }
        let dx = pointer.x - start.x, dy = pointer.y - start.y
        if hypot(dx, dy) >= 4 { moved = true }
        if pointer.x - previous.x >= 1 { direction = "running-right" }
        if pointer.x - previous.x <= -1 { direction = "running-left" }
        previous = pointer
        return moved ? CGPoint(x: origin.x + dx, y: origin.y + dy) : nil
    }
    mutating func end() -> Bool { let result = moved; start = nil; moved = false; return result }
}

enum PetGeometry {
    static func clamp(_ point: CGPoint, size: CGSize, to bounds: CGRect) -> CGPoint {
        CGPoint(x: min(max(bounds.minX, bounds.maxX-size.width), max(bounds.minX, point.x)),
                y: min(max(bounds.minY, bounds.maxY-size.height), max(bounds.minY, point.y)))
    }
    static func position(owner: CGRect, offset: CGPoint) -> CGPoint {
        CGPoint(x:owner.maxX+offset.x, y:owner.minY+offset.y)
    }
    static func offset(owner: CGRect, position: CGPoint) -> CGPoint {
        CGPoint(x:position.x-owner.maxX, y:position.y-owner.minY)
    }
}

struct PetFrame: Equatable {
    let row: Int
    let column: Int
    let duration: Double
}

enum PetAnimation {
    static let states = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"]
    static let counts = [6, 8, 8, 4, 5, 8, 6, 6, 6]
    static func frames(_ state: String, reduced: Bool = false) -> [PetFrame] {
        let row = states.firstIndex(of: state) ?? 0
        let base = [0.28, 0.11, 0.11, 0.14, 0.14, 0.32]
        let regular = [0.0, 0.12, 0.12, 0.14, 0.14, 0.14, 0.15, 0.12, 0.15]
        let last = [0.0, 0.22, 0.22, 0.28, 0.28, 0.24, 0.26, 0.22, 0.28]
        let frames = (0..<counts[row]).map { c in
            PetFrame(row: row, column: c, duration: row == 0 ? base[c] * 6 : (c == counts[row] - 1 ? last[row] : regular[row]))
        }
        return reduced ? [frames[0]] : frames
    }
    // Viewer coordinates: 0 = up, 4 = right, 8 = down, 12 = left.
    static func look(dx: Double, dy: Double) -> PetFrame? {
        guard hypot(dx, dy) > 1 else { return nil }
        let degrees = (atan2(dx, -dy) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
        let index = Int((degrees / 22.5).rounded()) % 16
        return PetFrame(row: 9 + index / 8, column: index % 8, duration: 0)
    }
}

struct PetClock {
    private(set) var state = "idle"
    private(set) var index = 0
    private var deadline = 0.0
    private var cycles = 0
    private var looping = true
    mutating func set(_ value: String, now: Double, loop: Bool = true) {
        guard PetAnimation.states.contains(value) else { return }
        if value == state && loop == looping { return }
        state = value; index = 0; cycles = 0; looping = loop
        deadline = now + PetAnimation.frames(value)[0].duration
    }
    mutating func frame(now: Double, reduced: Bool) -> PetFrame {
        let frames = PetAnimation.frames(state)
        if reduced { return frames[0] }
        if deadline == 0 { deadline = now + frames[0].duration }
        if now >= deadline {
            index += 1
            if index >= frames.count {
                index = 0; cycles += 1
                if !looping && cycles >= 3 { set("idle", now: now); return PetAnimation.frames("idle")[0] }
            }
            deadline = now + frames[index].duration
        }
        return frames[index]
    }
}
