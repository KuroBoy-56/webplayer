import Foundation

/**
 * Diagnóstico de la prueba del simulador (solo Debug y solo con LATMPX_DIAG): anota qué hacía el
 * reproductor y avisa cuando el hilo principal se queda bloqueado. En la versión publicada no hace nada.
 */
enum PlayerDiag {
    #if DEBUG
    private static let path = ProcessInfo.processInfo.environment["LATMPX_DIAG"] ?? ""
    private static let lock = NSLock()
    private static var phaseValue = ""
    private static let t0 = Date()

    static func phase(_ s: String) { lock.lock(); phaseValue = s; lock.unlock() }

    static func log(_ s: String) {
        guard !path.isEmpty else { return }
        let line = String(format: "%7.2f ", Date().timeIntervalSince(t0)) + s + "\n"
        lock.lock(); defer { lock.unlock() }
        if let h = FileHandle(forWritingAtPath: path) { h.seekToEndOfFile(); h.write(Data(line.utf8)); h.closeFile() }
        else { FileManager.default.createFile(atPath: path, contents: Data(line.utf8)) }
    }

    /** vigila el hilo principal: si no responde en 0,3 s se anota cuánto tardó y en qué estaba */
    static func watchdog() {
        guard !path.isEmpty else { return }
        log("inicio")
        let th = Thread {
            while true {
                let sem = DispatchSemaphore(value: 0)
                let start = Date()
                DispatchQueue.main.async { sem.signal() }
                if sem.wait(timeout: .now() + 0.3) == .timedOut {
                    lock.lock(); let p = phaseValue; lock.unlock()
                    sem.wait()
                    log(String(format: "HILO PRINCIPAL BLOQUEADO %.2f s · %@", Date().timeIntervalSince(start), p))
                }
                Thread.sleep(forTimeInterval: 0.1)
            }
        }
        th.start()
    }
    #else
    @inline(__always) static func phase(_ s: @autoclosure () -> String) {}
    @inline(__always) static func log(_ s: @autoclosure () -> String) {}
    static func watchdog() {}
    #endif
}
