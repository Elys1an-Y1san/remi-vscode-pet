import Foundation
import CoreGraphics
@main struct CoreTests {
    static func main() {
        let all = PetAnimation.states.flatMap { PetAnimation.frames($0) }
        precondition(all.count == 57)
        for (actual,expected) in zip(PetAnimation.frames("idle").map(\.duration), [1.68,0.66,0.66,0.84,0.84,1.92]) { precondition(abs(actual-expected) < 0.000001) }
        for (index,pair) in [(0,(0.0,-10.0)),(4,(10.0,0.0)),(8,(0.0,10.0)),(12,(-10.0,0.0))] {
            let f = PetAnimation.look(dx:pair.0,dy:pair.1)!
            precondition(f.row == 9+index/8 && f.column == index%8)
        }
        precondition(PetAnimation.look(dx:0,dy:0) == nil)
        for i in 0..<16 {
            let radians = Double(i)*22.5*Double.pi/180
            let f = PetAnimation.look(dx:sin(radians)*100,dy:-cos(radians)*100)!
            precondition(f.row*8+f.column == 9*8+i)
        }
        var clock = PetClock(); clock.set("waving",now:0,loop:false)
        for i in 0..<100 { _ = clock.frame(now:Double(i)*0.14,reduced:false) }
        precondition(clock.state == "idle")
        clock.set("running",now:20)
        precondition(clock.frame(now:100,reduced:true).column == 0)
        var drag = PetDrag()
        precondition(drag.move(pointer:.zero) == nil)
        drag.begin(pointer:CGPoint(x:100,y:100),origin:CGPoint(x:300,y:400))
        precondition(drag.move(pointer:CGPoint(x:102,y:101)) == nil)
        precondition(drag.end() == false)
        drag.begin(pointer:CGPoint(x:100,y:100),origin:CGPoint(x:300,y:400))
        precondition(drag.move(pointer:CGPoint(x:120,y:130)) == CGPoint(x:320,y:430))
        precondition(drag.direction == "running-right")
        precondition(drag.move(pointer:CGPoint(x:90,y:120)) == CGPoint(x:290,y:420))
        precondition(drag.direction == "running-left")
        precondition(drag.end())
        precondition(drag.move(pointer:.zero) == nil)
        let owner = CGRect(x:-1800,y:150,width:1440,height:900)
        let position = CGPoint(x:-500,y:350)
        let saved = PetGeometry.offset(owner:owner,position:position)
        precondition(PetGeometry.position(owner:owner,offset:saved) == position)
        let shifted = owner.offsetBy(dx:120,dy:60)
        precondition(PetGeometry.position(owner:shifted,offset:saved) == CGPoint(x:-380,y:410))
        precondition(PetGeometry.clamp(CGPoint(x:-2100,y:1100),size:CGSize(width:112,height:122),to:owner) == CGPoint(x:-1800,y:928))
        precondition(PetGeometry.clamp(.zero,size:CGSize(width:500,height:500),to:CGRect(x:10,y:20,width:100,height:100)) == CGPoint(x:10,y:20))
        print("PASS: 57 animation frames, 16 gaze directions, original timings, three-cycle fallback, reduced motion, click/drag threshold, direction reversal, release, saved offsets, negative monitor coordinates, edge clamps")
    }
}
