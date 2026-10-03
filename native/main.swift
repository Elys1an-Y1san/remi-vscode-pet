import AppKit
import QuartzCore

func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) else { return }
    print(text); fflush(stdout)
}

final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class ChatPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class FlippedStack: NSStackView {
    override var isFlipped: Bool { true }
}

final class ActionButton: NSButton {
    var handler: (() -> Void)?
    convenience init(_ title: String, action: @escaping () -> Void) {
        self.init(title: title, target: nil, action: #selector(run))
        self.target = self; self.handler = action; bezelStyle = .rounded
        setAccessibilityLabel(title)
    }
    @objc func run() { handler?() }
}

final class PetView: NSView {
    weak var owner: Overlay?
    var image: NSImage?
    var drag = PetDrag()
    override var isOpaque: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.clear.setFill(); dirtyRect.fill(using: .copy)
        image?.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
    }
    override func mouseDown(with event: NSEvent) {
        guard let origin = window?.frame.origin else { return }
        drag.begin(pointer:NSEvent.mouseLocation,origin:origin)
        owner?.dragging = true
    }
    override func mouseDragged(with event: NSEvent) {
        guard let owner, let destination = drag.move(pointer:NSEvent.mouseLocation) else { return }
        owner.clock.set(drag.direction, now: ProcessInfo.processInfo.systemUptime)
        owner.move(to:destination)
    }
    override func mouseUp(with event: NSEvent) {
        owner?.dragging = false
        if drag.end() { owner?.savePosition(); owner?.restoreState() }
        else {
            let point = convert(event.locationInWindow, from:nil)
            owner?.toggleBubble(owner?.badge.frame.contains(point) == true && owner?.badge.isHidden == false ? "activities" : "chat")
        }
    }
    override func rightMouseDown(with event: NSEvent) { owner?.showMenu(event: event) }
    override func accessibilityPerformPress() -> Bool { owner?.toggleBubble("chat"); return true }
}

final class Overlay: NSObject, NSApplicationDelegate, NSTextFieldDelegate {
    let panel = PetPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let bubble = ChatPanel(contentRect: NSRect(x:0,y:0,width:350,height:390), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let pet = PetView()
    var frames: [[NSImage]] = []
    var pixels: [[NSBitmapImageRep]] = []
    var clock = PetClock()
    var currentFrame = PetFrame(row:0,column:0,duration:0)
    var dragging = false
    var enabled = true, focused = true, followCursor = true, reduced = false
    var alwaysVisible = false
    var size = 112.0
    var offset = NSPoint(x: -150, y: 70)
    var ownerRect: NSRect?
    var editorBundle = "com.microsoft.VSCode"
    var editorPID: pid_t?
    var nativeState = "idle"
    var overrideUntil = 0.0
    var items: [[String:Any]] = []
    var bubbleMode: String?
    var response = ""
    var transcript: NSTextView?
    var input: NSTextField?
    var sendButton: ActionButton?
    var cancelButton: ActionButton?
    var chatBusy = false
    var timer: Timer?
    var lastOwnerCheck = 0.0
    var lastMouse = NSPoint.zero
    var lastMouseMove = 0.0
    var closing = false
    var badge = NSTextField(labelWithString: "")
    var stateFile: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        guard args.count > 1, let image = NSImage(contentsOfFile: args[1]),
              let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil), cg.width == 1536, cg.height == 2288 else {
            emit(["type":"error", "message":"原始动画素材缺失或尺寸错误"]); NSApp.terminate(nil); return
        }
        for row in 0..<11 {
            var images: [NSImage] = [], bitmaps: [NSBitmapImageRep] = []
            for col in 0..<8 {
                guard let crop = cg.cropping(to:CGRect(x:col*192,y:row*208,width:192,height:208)) else { continue }
                images.append(NSImage(cgImage:crop,size:NSSize(width:192,height:208)))
                bitmaps.append(NSBitmapImageRep(cgImage:crop))
            }
            frames.append(images); pixels.append(bitmaps)
        }
        NSApp.setActivationPolicy(.accessory)
        panel.title = "小蕾米 · 悬浮宠物"
        bubble.title = "小蕾米 · 聊天与动态"
        for p in [panel, bubble] {
            p.isOpaque = false; p.backgroundColor = .clear; p.level = .floating
            p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            p.hidesOnDeactivate = false; p.isReleasedWhenClosed = false
        }
        panel.hasShadow = false
        pet.owner = self; pet.setAccessibilityElement(true); pet.setAccessibilityRole(.button)
        pet.setAccessibilityLabel("小蕾米，点击聊天，拖动移动，右键更多操作")
        panel.contentView = pet
        badge.font = .systemFont(ofSize:10, weight:.bold); badge.textColor = .white
        badge.alignment = .center; badge.wantsLayer = true; badge.layer?.cornerRadius = 8
        badge.isHidden = true; pet.addSubview(badge)
        if args.count > 2 { stateFile = args[2] }
        timer = Timer(timeInterval:1.0/30, repeats:true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer!, forMode:.common)
        DispatchQueue.global(qos:.utility).async { [weak self] in
            while let line = readLine() {
                guard line.utf8.count < 1_000_000, let data = line.data(using:.utf8), let json = try? JSONSerialization.jsonObject(with:data) as? [String:Any] else { continue }
                DispatchQueue.main.async { [weak self] in self?.receive(json) }
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
        emit(["type":"ready", "frames":73, "pid":ProcessInfo.processInfo.processIdentifier])
    }

    func receive(_ message: [String:Any]) {
        switch message["type"] as? String {
        case "config":
            enabled = message["enabled"] as? Bool ?? enabled
            focused = message["focused"] as? Bool ?? focused
            followCursor = message["followCursor"] as? Bool ?? followCursor
            alwaysVisible = message["alwaysVisible"] as? Bool ?? alwaysVisible
            reduced = message["reducedMotion"] as? Bool ?? reduced
            size = min(240,max(64,message["size"] as? Double ?? size))
            editorBundle = message["editorBundle"] as? String ?? editorBundle
            if let pid = message["editorPID"] as? Int { editorPID = pid_t(pid) }
            if let x = message["offsetX"] as? Double, let y = message["offsetY"] as? Double, x.isFinite, y.isFinite { offset = NSPoint(x:x,y:y) }
            panel.setContentSize(NSSize(width:size,height:size*208/192))
            badge.frame = NSRect(x:size-22,y:8,width:18,height:16)
            positionPet(); updateVisibility()
        case "focus": focused = message["focused"] as? Bool ?? false; updateVisibility()
        case "activities":
            items = message["items"] as? [[String:Any]] ?? []
            nativeState = message["state"] as? String ?? "idle"
            badge.stringValue = items.count > 9 ? "9+" : String(items.count)
            badge.isHidden = items.isEmpty
            badge.layer?.backgroundColor = (nativeState == "failed" ? NSColor.systemRed : nativeState == "waiting" ? NSColor.systemOrange : NSColor.systemBlue).cgColor
            if !dragging && ProcessInfo.processInfo.systemUptime >= overrideUntil { restoreState() }
            if bubbleMode == "activities" { buildBubble() }
        case "animate":
            let state = message["state"] as? String ?? "idle"
            clock.set(state, now:ProcessInfo.processInfo.systemUptime, loop:false)
            overrideUntil = ProcessInfo.processInfo.systemUptime + PetAnimation.frames(state).reduce(0) { $0+$1.duration } * 3
        case "bubble": toggleBubble(message["mode"] as? String ?? "chat", force:true)
        case "chat":
            response = message["text"] as? String ?? ""
            chatBusy = message["busy"] as? Bool ?? false
            transcript?.string = response
            transcript?.scrollToEndOfDocument(nil)
            sendButton?.isEnabled = !chatBusy; cancelButton?.isHidden = !chatBusy
        case "reset": offset = NSPoint(x:-150,y:70); positionPet(); savePosition()
        case "hide": enabled = false; closeBubble(); updateVisibility()
        case "show": enabled = true; updateVisibility()
        case "snapshot": writeSnapshot()
        case "quit": closing = true; NSApp.terminate(nil)
        default: break
        }
    }

    func tick() {
        let now = ProcessInfo.processInfo.systemUptime
        if now-lastOwnerCheck > 0.2 { lastOwnerCheck = now; updateOwner(); updateVisibility() }
        guard panel.isVisible, !frames.isEmpty else { return }
        if overrideUntil > 0 && now >= overrideUntil { overrideUntil = 0; restoreState() }
        var frame = clock.frame(now:now,reduced:reduced || NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
        let mouse = NSEvent.mouseLocation
        if mouse != lastMouse { lastMouseMove = now; lastMouse = mouse }
        if followCursor && !reduced && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion && !dragging && overrideUntil == 0 && bubbleMode == nil && now-lastMouseMove < 1.5 {
            let dx = mouse.x-panel.frame.midX, dy = panel.frame.midY-mouse.y
            if hypot(dx,dy) < 600, let gaze = PetAnimation.look(dx:dx,dy:dy) { frame = gaze }
        }
        if frame != currentFrame || pet.image == nil {
            currentFrame = frame; pet.image = frames[frame.row][frame.column]; pet.needsDisplay = true
        }
        // Only the visible character intercepts the pointer; transparent corners remain editable.
        if !dragging {
            let p = panel.convertPoint(fromScreen:mouse)
            let x = Int(p.x / size * 192), y = 207-Int(p.y / (size*208/192) * 208)
            let onBadge = !badge.isHidden && badge.frame.contains(p)
            let alpha = (0..<192).contains(x) && (0..<208).contains(y) ? pixels[frame.row][frame.column].colorAt(x:x,y:y)?.alphaComponent ?? 0 : 0
            panel.ignoresMouseEvents = !onBadge && alpha < 0.05
        }
    }

    func updateOwner() {
        guard let code = NSWorkspace.shared.runningApplications.first(where: { editorPID != nil ? $0.processIdentifier == editorPID : $0.bundleIdentifier == editorBundle }) else { ownerRect = nil; return }
        guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] else { return }
        let top = NSScreen.screens.first?.frame.maxY ?? 0
        for info in windows {
            guard info[kCGWindowOwnerPID as String] as? pid_t == code.processIdentifier,
                  info[kCGWindowLayer as String] as? Int == 0,
                  let value = info[kCGWindowBounds as String] as? [String:Any],
                  let rect = CGRect(dictionaryRepresentation:value as CFDictionary), rect.width > 300, rect.height > 200 else { continue }
            let converted = NSRect(x:rect.minX,y:top-rect.maxY,width:rect.width,height:rect.height)
            if ownerRect != converted { ownerRect = converted; if !dragging { positionPet() } }
            return
        }
        ownerRect = nil
    }

    func updateVisibility() {
        let front = NSWorkspace.shared.frontmostApplication
        let editorIsFront = editorPID != nil ? front?.processIdentifier == editorPID : front?.bundleIdentifier == editorBundle
        let ourUI = bubbleMode != nil && (front?.processIdentifier == ProcessInfo.processInfo.processIdentifier || (editorIsFront && bubble.isKeyWindow))
        let visible = enabled && ownerRect != nil && (alwaysVisible || ((focused || ourUI) && (editorIsFront || ourUI)))
        if visible { if !panel.isVisible { panel.orderFrontRegardless() }; if bubbleMode != nil && !bubble.isVisible { bubble.orderFrontRegardless() } }
        else { panel.orderOut(nil); bubble.orderOut(nil) }
    }

    func positionPet() {
        guard let rect = ownerRect else { return }
        move(to:PetGeometry.position(owner:rect,offset:offset))
    }
    func move(to point: NSPoint) {
        let mouse = NSEvent.mouseLocation
        let anchor = dragging ? mouse : point
        let screen = NSScreen.screens.first(where:{$0.frame.contains(anchor)})
            ?? NSScreen.screens.first(where:{$0.frame.intersects(ownerRect ?? .zero)})
            ?? panel.screen ?? NSScreen.main
        let bounds = screen?.visibleFrame ?? NSRect(x:0,y:0,width:1440,height:900)
        let p = PetGeometry.clamp(point,size:panel.frame.size,to:bounds)
        panel.setFrameOrigin(p); positionBubble()
    }
    func savePosition() {
        if let rect = ownerRect { offset = PetGeometry.offset(owner:rect,position:panel.frame.origin) }
        emit(["type":"position","x":offset.x,"y":offset.y])
    }
    func restoreState() { clock.set(nativeState,now:ProcessInfo.processInfo.systemUptime) }

    func toggleBubble(_ mode: String, force: Bool = false) {
        if bubbleMode == mode && bubble.isVisible && !force { closeBubble(); return }
        bubbleMode = mode; buildBubble(); positionBubble(); bubble.makeKeyAndOrderFront(nil)
        if mode == "chat" { bubble.makeFirstResponder(input) }
    }
    func closeBubble() { bubbleMode = nil; bubble.orderOut(nil) }
    func positionBubble() {
        let area = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? NSRect(x:0,y:0,width:1440,height:900)
        let above = panel.frame.maxY+10
        let y = above+bubble.frame.height <= area.maxY ? above : panel.frame.minY-bubble.frame.height-10
        bubble.setFrameOrigin(NSPoint(x:min(area.maxX-bubble.frame.width-8,max(area.minX+8,panel.frame.maxX-bubble.frame.width)),y:max(area.minY+8,min(area.maxY-bubble.frame.height-8,y))))
    }

    func text(_ text: String, font: NSFont = .systemFont(ofSize:12), color: NSColor = .labelColor) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString:text); label.font = font; label.textColor = color
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }
    func buildBubble() {
        transcript = nil; input = nil; sendButton = nil; cancelButton = nil
        let glass = NSVisualEffectView(); glass.material = .popover; glass.blendingMode = .behindWindow; glass.state = .active
        glass.wantsLayer = true; glass.layer?.cornerRadius = 18; glass.layer?.masksToBounds = true
        bubble.contentView = glass; bubble.hasShadow = true
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false; glass.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo:glass.leadingAnchor,constant:16),stack.trailingAnchor.constraint(equalTo:glass.trailingAnchor,constant:-16),stack.topAnchor.constraint(equalTo:glass.topAnchor,constant:14),stack.bottomAnchor.constraint(equalTo:glass.bottomAnchor,constant:-14)])
        let header = NSStackView(); header.orientation = .horizontal; header.spacing = 8
        header.addArrangedSubview(text("小蕾米",font:.systemFont(ofSize:14,weight:.semibold)))
        header.addArrangedSubview(ActionButton(bubbleMode == "chat" ? "动态 \(items.count)" : "聊天") { [weak self] in guard let self else { return }; self.toggleBubble(self.bubbleMode == "chat" ? "activities" : "chat",force:true) })
        header.addArrangedSubview(ActionButton("关闭") { [weak self] in self?.closeBubble() })
        stack.addArrangedSubview(header)
        if bubbleMode == "chat" {
            let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.drawsBackground = false
            let body = NSTextView(frame:NSRect(x:0,y:0,width:310,height:240)); body.isEditable = false; body.isSelectable = true; body.drawsBackground = false
            body.font = .systemFont(ofSize:13); body.textColor = .labelColor
            body.textContainer?.widthTracksTextView = true; body.autoresizingMask = [.width]
            body.string = response.isEmpty ? "在这里和小蕾米聊聊。\n\n使用你在编辑器中启用的模型。文件不会自动附带。" : response
            body.setAccessibilityLabel("聊天记录"); scroll.documentView = body; transcript = body
            stack.addArrangedSubview(scroll); scroll.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive = true
            scroll.heightAnchor.constraint(greaterThanOrEqualToConstant:210).isActive = true
            let field = NSTextField(); field.placeholderString = "问点什么…"; field.delegate = self
            field.target = self; field.action = #selector(submit); field.setAccessibilityLabel("发送给小蕾米的消息")
            stack.addArrangedSubview(field); field.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive = true; input = field
            let row = NSStackView(); row.orientation = .horizontal
            let send = ActionButton("发送") { [weak self] in self?.submit() }; send.isEnabled = !chatBusy; sendButton = send
            let cancel = ActionButton("停止") { emit(["type":"cancelChat"]) }; cancel.isHidden = !chatBusy; cancelButton = cancel
            row.addArrangedSubview(send); row.addArrangedSubview(cancel)
            row.addArrangedSubview(ActionButton("在编辑器聊天") { emit(["type":"openChat"]) })
            stack.addArrangedSubview(row)
        } else {
            let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.drawsBackground = false
            let list = FlippedStack(); list.orientation = .vertical; list.alignment = .leading; list.spacing = 12; list.translatesAutoresizingMaskIntoConstraints = false
            scroll.documentView = list
            if items.isEmpty { list.addArrangedSubview(text("暂时没有任务。运行任务或终端命令后，会显示在这里。",color:.secondaryLabelColor)) }
            for item in items {
                guard let id = item["id"] as? String else { continue }
                let card = NSStackView(); card.orientation = .vertical; card.alignment = .leading; card.spacing = 5
                let state = item["state"] as? String ?? "idle"
                let label = ["running":"进行中", "waiting":"需要你确认", "review":"已完成", "failed":"遇到问题"][state] ?? "待机"
                card.addArrangedSubview(text(label,font:.systemFont(ofSize:10,weight:.medium),color:state == "failed" ? .systemRed : .secondaryLabelColor))
                card.addArrangedSubview(text(item["title"] as? String ?? "任务",font:.systemFont(ofSize:13,weight:.semibold)))
                card.addArrangedSubview(text(item["body"] as? String ?? "",color:.secondaryLabelColor))
                let actions = NSStackView(); actions.orientation = .horizontal
                for action in item["actions"] as? [String] ?? [] {
                    let title = ["open":"查看","cancel":"停止","approve":"允许","deny":"拒绝"][action] ?? action
                    actions.addArrangedSubview(ActionButton(title) { emit(["type":"action","id":id,"action":action]) })
                }
                if !["running","waiting"].contains(state) { actions.addArrangedSubview(ActionButton("收起") { emit(["type":"dismiss","id":id]) }) }
                card.addArrangedSubview(actions); list.addArrangedSubview(card)
                card.widthAnchor.constraint(equalToConstant:302).isActive = true
            }
            stack.addArrangedSubview(scroll); scroll.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive = true
            list.leadingAnchor.constraint(equalTo:scroll.contentView.leadingAnchor).isActive = true
            list.trailingAnchor.constraint(equalTo:scroll.contentView.trailingAnchor).isActive = true
            list.topAnchor.constraint(equalTo:scroll.contentView.topAnchor).isActive = true
        }
    }

    @objc func submit() {
        guard !chatBusy, let value = input?.stringValue.trimmingCharacters(in:.whitespacesAndNewlines), !value.isEmpty else { return }
        chatBusy = true; sendButton?.isEnabled = false; cancelButton?.isHidden = false
        input?.stringValue = ""; emit(["type":"chat","text":String(value.prefix(16000))])
    }
    func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        if commandSelector == #selector(NSResponder.cancelOperation(_:)) { closeBubble(); return true }
        return false
    }
    func showMenu(event: NSEvent) {
        let menu = NSMenu()
        for (title, action) in [("快捷聊天","chat"),("任务动态","activities"),("打个招呼","waving"),("跳一跳","jumping"),("设置…","settings"),("重置位置","reset"),("隐藏小蕾米","hide")] {
            let item = NSMenuItem(title:title,action:#selector(menuAction(_:)),keyEquivalent:"")
            item.representedObject = action; item.target = self; menu.addItem(item)
        }
        NSMenu.popUpContextMenu(menu,with:event,for:pet)
    }
    @objc func menuAction(_ item: NSMenuItem) {
        guard let action = item.representedObject as? String else { return }
        switch action {
        case "chat", "activities": toggleBubble(action,force:true)
        case "waving", "jumping": receive(["type":"animate","state":action])
        case "reset": receive(["type":"reset"])
        case "hide": receive(["type":"hide"]); emit(["type":"hide"])
        default: emit(["type":action])
        }
    }
    func writeSnapshot() {
        let value: [String:Any] = ["type":"snapshot","visible":panel.isVisible,"focused":focused,"editorPID":Int(editorPID ?? 0),"frontBundle":NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "none","frontPID":Int(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0),"state":clock.state,"row":currentFrame.row,"column":currentFrame.column,"frame":["x":panel.frame.minX,"y":panel.frame.minY,"width":panel.frame.width,"height":panel.frame.height],"activities":items.count,"bubble":bubbleMode ?? "none","ownerFound":ownerRect != nil,"clickThrough":panel.ignoresMouseEvents]
        emit(value)
        if let stateFile, let data = try? JSONSerialization.data(withJSONObject:value,options:[.prettyPrinted,.sortedKeys]) { try? data.write(to:URL(fileURLWithPath:stateFile),options:.atomic) }
    }
}

let app = NSApplication.shared
let overlay = Overlay()
app.delegate = overlay
app.run()
