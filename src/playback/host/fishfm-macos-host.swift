// macOS audio and Keychain helper for FishFM.
//
// The playback mode owns one AF_UNIX socket and an AVPlayer. Secrets cross the
// helper boundary only over stdin/stdout JSON, never in process arguments.
import AVFoundation
import CoreMedia
import Darwin
import Foundation
import Security

private let protocolVersionDefault = 1
private let keychainService = "com.dsh.feiyufm"

private func writeJSON(_ value: [String: Any], to handle: FileHandle = .standardOutput) throws {
    var bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    bytes.append(0x0A)
    try handle.write(contentsOf: bytes)
}

private func runCredentialCommand() throws {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let request = try JSONSerialization.jsonObject(with: input) as? [String: Any],
          let operation = request["operation"] as? String,
          let account = request["reference"] as? String,
          !account.isEmpty,
          account.utf8.count <= 256 else {
        throw NSError(domain: "FishFMKeychain", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid credential request"])
    }

    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: keychainService,
        kSecAttrAccount as String: account,
    ]

    switch operation {
    case "read":
        var attributes = query
        attributes[kSecReturnData as String] = true
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(attributes as CFDictionary, &result)
        if status == errSecItemNotFound {
            try writeJSON(["value": NSNull()])
            return
        }
        guard status == errSecSuccess,
              let data = result as? Data,
              let secret = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "FishFMKeychain", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Could not read the FishFM Keychain item (OSStatus \(status))"])
        }
        try writeJSON(["value": secret])

    case "exists":
        var attributes = query
        attributes[kSecReturnData as String] = false
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        let status = SecItemCopyMatching(attributes as CFDictionary, nil)
        if status == errSecSuccess || status == errSecInteractionNotAllowed {
            try writeJSON(["present": true])
        } else if status == errSecItemNotFound {
            try writeJSON(["present": false])
        } else {
            throw NSError(domain: "FishFMKeychain", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Could not inspect the FishFM Keychain item (OSStatus \(status))"])
        }

    case "write":
        guard let secret = request["secret"] as? String, !secret.isEmpty else {
            throw NSError(domain: "FishFMKeychain", code: 2, userInfo: [NSLocalizedDescriptionKey: "A non-empty credential is required"])
        }
        let data = Data(secret.utf8)
        let update = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if updateStatus == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            item[kSecAttrLabel as String] = "FishFM music platform session"
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw NSError(domain: "FishFMKeychain", code: Int(addStatus), userInfo: [NSLocalizedDescriptionKey: "Could not save the FishFM Keychain item (OSStatus \(addStatus))"])
            }
        } else if updateStatus != errSecSuccess {
            throw NSError(domain: "FishFMKeychain", code: Int(updateStatus), userInfo: [NSLocalizedDescriptionKey: "Could not update the FishFM Keychain item (OSStatus \(updateStatus))"])
        }
        try writeJSON(["saved": true])

    case "delete":
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: "FishFMKeychain", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Could not remove the FishFM Keychain item (OSStatus \(status))"])
        }
        try writeJSON(["deleted": true])

    default:
        throw NSError(domain: "FishFMKeychain", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unknown credential operation"])
    }
}

private final class AudioHost {
    private let socketPath: String
    private let ownerPID: pid_t
    private let protocolVersion: Int
    private var listener: Int32 = -1
    private var client: Int32 = -1
    private var listenerSource: DispatchSourceRead?
    private var clientSource: DispatchSourceRead?
    private var ownerTimer: DispatchSourceTimer?
    private var signalSources: [DispatchSourceSignal] = []
    private var input = Data()

    private let player = AVPlayer()
    private var itemObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var timeObserver: Any?
    private var pendingLoad: (id: String, item: AVPlayerItem, startMs: Int, deadline: DispatchTime)?
    private var status = "idle"
    private var playInstanceID: String?
    private var version: Int?
    private var acceptedVersion = -1
    private var muted = false
    private var resource: String?
    private var durationMs: Int?
    private var errorCode: String?
    private var errorMessage: String?
    private var positionAtPlay = 0
    private var lastProgress = -1
    private var lastAdvanceAt = Date()
    private var startedSent = false
    private var isStopping = false

    init(socketPath: String, ownerPID: pid_t, protocolVersion: Int) {
        self.socketPath = socketPath
        self.ownerPID = ownerPID
        self.protocolVersion = protocolVersion
        player.volume = 0.35
        player.actionAtItemEnd = .pause
    }

    func run() throws {
        try openListener()
        listenerSource = DispatchSource.makeReadSource(fileDescriptor: listener, queue: .main)
        listenerSource?.setEventHandler { [weak self] in self?.acceptClient() }
        listenerSource?.setCancelHandler { [fd = listener] in if fd >= 0 { Darwin.close(fd) } }
        listenerSource?.resume()

        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(value: 1, timescale: 5), queue: .main
        ) { [weak self] time in self?.onTick(time) }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main
        ) { [weak self] note in
            guard let self, let ended = note.object as? AVPlayerItem,
                  ended === self.player.currentItem, self.status == "playing" else { return }
            self.status = "ended"
            self.sendEvent("ended", extra: ["positionMs": self.position()])
            self.marker("FISHFM_PLAYBACK_MEDIA_ENDED")
        }

        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in self?.checkOwner() }
        ownerTimer = timer
        timer.resume()

        for signalNumber in [SIGINT, SIGTERM, SIGHUP] {
            Darwin.signal(signalNumber, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
            source.setEventHandler { [weak self] in
                guard let self else { return }
                self.stopPlayback()
                self.sendEvent("exiting")
                self.cleanup()
                exit(0)
            }
            source.resume()
            signalSources.append(source)
        }

        marker("FISHFM_PLAYBACK_READY protocol=\(protocolVersion) pid=\(getpid())")
        RunLoop.main.run()
    }

    private func openListener() throws {
        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw posixError("Could not create playback socket") }
        var noSigpipe: Int32 = 1
        _ = setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSigpipe, socklen_t(MemoryLayout<Int32>.size))

        do {
            var address = sockaddr_un()
            address.sun_family = sa_family_t(AF_UNIX)
            let path = Array(socketPath.utf8CString)
            let capacity = MemoryLayout.size(ofValue: address.sun_path)
            guard path.count <= capacity else {
                throw NSError(domain: "FishFMAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Playback socket path is too long"])
            }
            withUnsafeMutablePointer(to: &address.sun_path) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: capacity) { destination in
                    for (index, byte) in path.enumerated() { destination[index] = byte }
                }
            }
            let socketAddressLength = MemoryLayout<UInt8>.size
                + MemoryLayout<sa_family_t>.size + path.count
            address.sun_len = UInt8(socketAddressLength)
            _ = unlink(socketPath)
            let bound = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.bind(fd, $0, socklen_t(socketAddressLength))
                }
            }
            guard bound == 0 else { throw posixError("Could not bind playback socket") }
            _ = chmod(socketPath, mode_t(S_IRUSR | S_IWUSR))
            guard Darwin.listen(fd, 1) == 0 else { throw posixError("Could not listen on playback socket") }
            listener = fd
        } catch {
            Darwin.close(fd)
            _ = unlink(socketPath)
            throw error
        }
    }

    private func acceptClient() {
        guard client < 0 else { return }
        var address = sockaddr_un()
        var length = socklen_t(MemoryLayout<sockaddr_un>.size)
        let fd = withUnsafeMutablePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.accept(listener, $0, &length)
            }
        }
        guard fd >= 0 else { return }
        client = fd
        input.removeAll(keepingCapacity: true)
        var noSigpipe: Int32 = 1
        _ = setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSigpipe, socklen_t(MemoryLayout<Int32>.size))
        clientSource = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .main)
        clientSource?.setEventHandler { [weak self] in self?.readClient() }
        clientSource?.setCancelHandler { [fd] in Darwin.close(fd) }
        clientSource?.resume()
        send([
            "type": "hello", "protocol": protocolVersion, "pid": getpid(),
            "backend": "avfoundation", "ownerPid": ownerPID,
            "capabilities": ["seek": true, "mute": true, "volume": true],
        ])
        sendState()
        marker("FISHFM_PLAYBACK_CLIENT_CONNECTED")
    }

    private func readClient() {
        guard client >= 0 else { return }
        var buffer = [UInt8](repeating: 0, count: 16_384)
        let count = Darwin.recv(client, &buffer, buffer.count, 0)
        if count == 0 { disconnectClient(); return }
        if count < 0 {
            if errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR { disconnectClient() }
            return
        }
        input.append(contentsOf: buffer.prefix(count))
        if input.count > 1_048_576 { disconnectClient(); return }
        while let newline = input.firstIndex(of: 0x0A) {
            let line = input[..<newline]
            input.removeSubrange(...newline)
            guard let text = String(data: line, encoding: .utf8),
                  let command = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else {
                sendResultError("", code: "invalid_command", message: "Command line is not JSON")
                continue
            }
            handle(command)
        }
    }

    private func disconnectClient() {
        guard client >= 0 else { return }
        let source = clientSource
        clientSource = nil
        client = -1
        source?.cancel()
        input.removeAll(keepingCapacity: true)
        marker("FISHFM_PLAYBACK_CLIENT_DISCONNECTED")
    }

    private func handle(_ command: [String: Any]) {
        let id = command["id"] as? String ?? ""
        let type = command["type"] as? String ?? ""
        if let commandVersion = command["version"] as? NSNumber {
            let value = commandVersion.intValue
            if value < acceptedVersion {
                sendResultError(id, code: "stale_version", message: "Ignored an older playback command")
                return
            }
            acceptedVersion = value
            if playInstanceID != nil { version = value }
        }

        switch type {
        case "load": load(command, id: id)
        case "play":
            guard player.currentItem != nil, playInstanceID != nil else {
                sendResultError(id, code: "no_media", message: "Nothing is loaded")
                return
            }
            player.play()
            status = "playing"
            positionAtPlay = position()
            lastProgress = -1
            startedSent = false
            lastAdvanceAt = Date()
            sendResult(id, extra: ["positionMs": positionAtPlay])
        case "pause":
            cancelPendingLoad(message: "Media open was superseded by a playback control")
            player.pause()
            if status == "playing" || status == "ready" { status = "paused" }
            sendResult(id, extra: ["positionMs": position()])
        case "stop":
            stopPlayback()
            sendResult(id, extra: ["positionMs": 0])
        case "setMuted":
            muted = (command["muted"] as? Bool) ?? false
            player.isMuted = muted
            sendResult(id, extra: ["muted": muted, "positionMs": position()])
        case "snapshot", "ping": sendResult(id)
        case "shutdown":
            stopPlayback()
            sendResult(id)
            sendEvent("exiting")
            isStopping = true
            cleanup()
            exit(0)
        default: sendResultError(id, code: "invalid_command", message: "Unknown command: \(type)")
        }
    }

    private func load(_ command: [String: Any], id: String) {
        guard let value = command["resource"] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            sendResultError(id, code: "resource_missing", message: "load needs a resource handle")
            return
        }
        cancelPendingLoad(message: "Media open was superseded by another load")
        player.pause()
        player.replaceCurrentItem(with: nil)
        status = "loading"
        playInstanceID = command["playInstanceId"] as? String
        version = (command["version"] as? NSNumber)?.intValue
        resource = value
        durationMs = nil
        errorCode = nil
        errorMessage = nil
        positionAtPlay = 0
        lastProgress = -1
        startedSent = false

        let url: URL
        if let parsed = URL(string: value), let scheme = parsed.scheme?.lowercased(), ["http", "https", "file"].contains(scheme) {
            url = parsed
        } else {
            url = URL(fileURLWithPath: value)
        }
        if url.isFileURL && !FileManager.default.fileExists(atPath: url.path) {
            status = "error"
            errorCode = "unsupported_resource"
            errorMessage = "Resource is not a readable local file or URL"
            sendResultError(id, code: errorCode!, message: errorMessage!)
            return
        }

        let item = AVPlayerItem(url: url)
        let start = max(0, (command["startPositionMs"] as? NSNumber)?.intValue ?? 0)
        let timeoutMs = max(1, (command["openTimeoutMs"] as? NSNumber)?.intValue ?? 12_000)
        pendingLoad = (id, item, start, .now() + .milliseconds(timeoutMs))
        itemObservation = item.observe(\.status, options: [.new]) { [weak self, weak item] observed, _ in
            DispatchQueue.main.async {
                guard let self, let item, observed === item, self.player.currentItem === item else { return }
                self.onItemStatus(item)
            }
        }
        player.replaceCurrentItem(with: item)
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) { [weak self, weak item] in
            guard let self, let item, self.pendingLoad?.item === item else { return }
            self.failPendingLoad(code: "media_open_timeout", message: "Media did not open within \(timeoutMs) ms")
        }
    }

    private func onItemStatus(_ item: AVPlayerItem) {
        switch item.status {
        case .readyToPlay:
            guard let pending = pendingLoad, pending.item === item else { return }
            let duration = item.duration
            durationMs = duration.isValid && duration.isNumeric && duration.seconds.isFinite
                ? max(0, Int((duration.seconds * 1_000).rounded())) : nil
            player.isMuted = muted
            if pending.startMs > 0 {
                let time = CMTime(seconds: Double(pending.startMs) / 1_000, preferredTimescale: 1_000)
                item.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self, weak item] finished in
                    DispatchQueue.main.async {
                        guard let self, let item, self.pendingLoad?.item === item else { return }
                        self.completeLoad(pending.id, position: finished ? pending.startMs : self.position(), seeked: finished)
                    }
                }
            } else {
                completeLoad(pending.id, position: position(), seeked: true)
            }
        case .failed:
            if pendingLoad?.item === item {
                failPendingLoad(code: "media_failed", message: "Media playback failed")
            } else if player.currentItem === item, playInstanceID != nil {
                status = "error"
                errorCode = "media_failed"
                errorMessage = "Media playback failed"
                player.pause()
                sendEvent("error", extra: ["code": errorCode!, "message": errorMessage!, "retryable": true])
                sendState()
            }
        case .unknown: break
        @unknown default: failPendingLoad(code: "media_failed", message: "Media playback failed")
        }
    }

    private func completeLoad(_ id: String, position: Int, seeked: Bool) {
        guard pendingLoad?.id == id else { return }
        pendingLoad = nil
        status = "ready"
        sendResult(id, extra: [
            "positionMs": max(0, position), "seek": seeked,
            "muted": muted, "durationMs": durationMs.map { $0 as Any } ?? NSNull(),
        ])
    }

    private func failPendingLoad(code: String, message: String) {
        guard let pending = pendingLoad else { return }
        pendingLoad = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
        itemObservation = nil
        status = "error"
        errorCode = code
        errorMessage = message
        sendResultError(pending.id, code: code, message: message, retryable: true)
    }

    private func cancelPendingLoad(message: String) {
        guard let pending = pendingLoad else { return }
        pendingLoad = nil
        itemObservation = nil
        sendResultError(pending.id, code: "cancelled", message: message)
    }

    private func stopPlayback() {
        cancelPendingLoad(message: "Media open was superseded by a playback control")
        player.pause()
        player.replaceCurrentItem(with: nil)
        itemObservation = nil
        status = "idle"
        playInstanceID = nil
        version = nil
        resource = nil
        durationMs = nil
        errorCode = nil
        errorMessage = nil
        lastProgress = -1
        startedSent = false
    }

    private func onTick(_ time: CMTime) {
        guard status == "playing" else { return }
        if let pending = pendingLoad, DispatchTime.now() >= pending.deadline {
            failPendingLoad(code: "media_open_timeout", message: "Media did not open before its deadline")
            return
        }
        let current = position(time)
        if current > lastProgress {
            lastProgress = current
            lastAdvanceAt = Date()
            if current > 0 && current > positionAtPlay {
                if !startedSent {
                    startedSent = true
                    sendEvent("started", extra: ["positionMs": current, "progressSource": "audio"])
                } else {
                    sendEvent("progress", extra: ["positionMs": current, "progressSource": "audio"])
                }
            }
        } else if Date().timeIntervalSince(lastAdvanceAt) >= 15 {
            status = "error"
            errorCode = "media_stalled"
            errorMessage = "Audio timeline did not advance for 15 seconds"
            player.pause()
            sendEvent("error", extra: ["code": errorCode!, "message": errorMessage!, "retryable": true])
            sendState()
        }
        sendState()
    }

    private func position(_ time: CMTime? = nil) -> Int {
        let value = time ?? player.currentTime()
        guard value.isValid && value.isNumeric && value.seconds.isFinite else { return 0 }
        return max(0, Int((value.seconds * 1_000).rounded()))
    }

    private func state() -> [String: Any] {
        [
            "status": status,
            "playInstanceId": playInstanceID.map { $0 as Any } ?? NSNull(),
            "version": version.map { $0 as Any } ?? NSNull(),
            "positionMs": position(),
            "durationMs": durationMs.map { $0 as Any } ?? NSNull(),
            "muted": muted,
            "seek": true,
            "resource": resource.map { $0 as Any } ?? NSNull(),
            "errorCode": errorCode.map { $0 as Any } ?? NSNull(),
            "errorMessage": errorMessage.map { $0 as Any } ?? NSNull(),
            "retryable": status == "error" && playInstanceID != nil,
        ]
    }

    private func sendState() { send(["type": "state"].merging(state()) { _, new in new }) }

    private func sendResult(_ id: String, extra: [String: Any] = [:]) {
        var payload: [String: Any] = ["type": "result", "id": id, "ok": true, "state": state()]
        payload.merge(extra) { _, new in new }
        send(payload)
    }

    private func sendResultError(_ id: String, code: String, message: String, retryable: Bool = false) {
        send(["type": "result", "id": id, "ok": false,
              "error": ["code": code, "message": message, "retryable": retryable], "state": state()])
    }

    private func sendEvent(_ event: String, extra: [String: Any] = [:]) {
        var payload: [String: Any] = [
            "type": "event", "event": event,
            "playInstanceId": playInstanceID.map { $0 as Any } ?? NSNull(),
            "version": version.map { $0 as Any } ?? NSNull(),
        ]
        payload.merge(extra) { _, new in new }
        send(payload)
    }

    private func send(_ payload: [String: Any]) {
        guard client >= 0 else { return }
        do {
            var message = payload
            message["v"] = protocolVersion
            var bytes = try JSONSerialization.data(withJSONObject: message, options: [.sortedKeys])
            bytes.append(0x0A)
            let success = bytes.withUnsafeBytes { raw -> Bool in
                guard let base = raw.baseAddress else { return false }
                var offset = 0
                while offset < raw.count {
                    let sent = Darwin.send(client, base.advanced(by: offset), raw.count - offset, 0)
                    if sent <= 0 { return false }
                    offset += sent
                }
                return true
            }
            if !success { disconnectClient() }
        } catch { disconnectClient() }
    }

    private func marker(_ text: String) {
        fputs("\(text)\n", stderr)
        fflush(stderr)
    }

    private func checkOwner() {
        guard ownerPID > 0 else { return }
        if Darwin.kill(ownerPID, 0) != 0 && errno != EPERM {
            marker("FISHFM_PLAYBACK_OWNER_GONE")
            stopPlayback()
            cleanup()
            exit(0)
        }
    }

    private func cleanup() {
        guard !isStopping || listenerSource != nil || clientSource != nil || listener >= 0 || client >= 0 else { return }
        isStopping = true
        player.pause()
        if let timeObserver { player.removeTimeObserver(timeObserver); self.timeObserver = nil }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver); self.endObserver = nil }
        ownerTimer?.cancel(); ownerTimer = nil
        signalSources.forEach { $0.cancel() }
        signalSources.removeAll()
        let clientSource = self.clientSource
        self.clientSource = nil
        client = -1
        clientSource?.cancel()
        let listenerSource = self.listenerSource
        self.listenerSource = nil
        if listenerSource != nil {
            listener = -1
            listenerSource?.cancel()
        } else if listener >= 0 {
            Darwin.close(listener)
            listener = -1
        }
        _ = unlink(socketPath)
    }
}

private func posixError(_ message: String) -> NSError {
    NSError(domain: NSPOSIXErrorDomain, code: Int(errno), userInfo: [NSLocalizedDescriptionKey: "\(message) (errno \(errno))"])
}

private func argument(_ name: String, default fallback: String? = nil) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name), index + 1 < CommandLine.arguments.count else { return fallback }
    return CommandLine.arguments[index + 1]
}

@main
private enum FishFMMacHost {
    static func main() {
        do {
            guard CommandLine.arguments.count > 1 else { throw NSError(domain: "FishFMMacHost", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected 'playback' or 'credential'"]) }
            switch CommandLine.arguments[1] {
            case "credential": try runCredentialCommand()
            case "playback":
                guard let socket = argument("--socket") else { throw NSError(domain: "FishFMMacHost", code: 2, userInfo: [NSLocalizedDescriptionKey: "Missing --socket"]) }
                let owner = pid_t(Int32(argument("--owner-pid", default: "0") ?? "0") ?? 0)
                let version = Int(argument("--protocol", default: String(protocolVersionDefault)) ?? String(protocolVersionDefault)) ?? protocolVersionDefault
                let host = AudioHost(socketPath: socket, ownerPID: owner, protocolVersion: version)
                try host.run()
            default: throw NSError(domain: "FishFMMacHost", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unknown helper mode"])
            }
        } catch {
            fputs("fishfm-macos-host: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }
}
