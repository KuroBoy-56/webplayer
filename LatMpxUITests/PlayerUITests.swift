import XCTest

/**
 * Prueba del reproductor en el simulador (solo en la compilación Debug de GitHub Actions):
 * abre un video y un canal de prueba, pausa, adelanta y cierra, y comprueba que la pantalla responde
 * también mientras un servidor no contesta (antes se quedaba congelada al salir).
 */
final class PlayerUITests: XCTestCase {
    private let movie = "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8"
    private let live = "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8"
    private let dead = "http://10.255.255.1/live/a.ts|http://10.255.255.1/live/b.ts"

    override func setUp() { continueAfterFailure = true }

    private func launch(_ urls: String, live: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        if let dir = ProcessInfo.processInfo.environment["SHOTS"], !dir.isEmpty {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            app.launchEnvironment["LATMPX_DIAG"] = dir + "/diag-" + name.filter { $0.isLetter || $0.isNumber } + ".txt"
        }
        app.launchArguments = ["-dist_choice", "skip", "-ui_test_player", urls] + (live ? ["-ui_test_live", "YES"] : [])
        app.launch()
        return app
    }

    private func shot(_ name: String) {
        let s = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: s)
        a.name = name
        a.lifetime = .keepAlways
        add(a)
        if let dir = ProcessInfo.processInfo.environment["SHOTS"], !dir.isEmpty {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? s.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent(name + ".png"))
        }
    }

    /** los controles se ocultan solos mientras reproduce: un toque en la imagen los vuelve a mostrar */
    private func controls(_ app: XCUIApplication) {
        if !app.buttons["player.close"].exists {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
            _ = app.buttons["player.close"].waitForExistence(timeout: 3)
        }
    }

    private func wait(_ timeout: TimeInterval, _ cond: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if cond() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        return cond()
    }

    private func value(_ e: XCUIElement) -> String { e.exists ? ((e.value as? String) ?? "") : "" }

    private func note(_ s: String) { print("TIEMPO \(name): \(s)") }

    func testMoviePlaysPausesSeeksAndCloses() {
        let app = launch(movie)
        XCTAssertTrue(app.buttons["player.close"].waitForExistence(timeout: 30), "no se abrió el reproductor")
        XCTAssertTrue(app.otherElements["player.screen"].exists, "no se encuentra la pantalla del reproductor")
        shot("1-pelicula-abierta")
        let toggle = app.buttons["player.toggle"]
        let playing = wait(60) { controls(app); return value(toggle) == "playing" }
        shot("2-pelicula-reproduciendo")
        XCTAssertTrue(playing, "el video no empezó a reproducirse")

        // la pantalla está en horizontal
        let f = app.windows.firstMatch.frame
        XCTAssertGreaterThan(f.width, f.height, "el reproductor no está en horizontal")

        controls(app)
        toggle.tap()
        XCTAssertTrue(wait(5) { controls(app); return value(toggle) == "paused" }, "no se pudo pausar")
        shot("3-pelicula-pausada")
        controls(app)
        toggle.tap()
        XCTAssertTrue(wait(10) { controls(app); return value(toggle) == "playing" }, "no se pudo reanudar")

        controls(app)
        let before = app.staticTexts["player.time"].label
        app.buttons["player.forward"].tap()
        app.buttons["player.forward"].tap()
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        controls(app)
        shot("4-pelicula-adelantada")
        XCTAssertNotEqual(app.staticTexts["player.time"].label, before, "adelantar no cambió el tiempo")

        controls(app)
        let c0 = Date()
        app.buttons["player.close"].tap()
        XCTAssertTrue(wait(5) { !app.otherElements["player.screen"].exists }, "no se pudo salir del reproductor")
        note(String(format: "película cerrada en %.2f s", Date().timeIntervalSince(c0)))
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        shot("5-pelicula-cerrada")
        let g = app.windows.firstMatch.frame
        XCTAssertLessThan(g.width, g.height, "al salir no volvió a vertical")
    }

    func testLiveChannelPlaysAndCloses() {
        let app = launch(live, live: true)
        XCTAssertTrue(app.buttons["player.close"].waitForExistence(timeout: 30), "no se abrió el canal")
        let toggle = app.buttons["player.toggle"]
        let playing = wait(60) { controls(app); return value(toggle) == "playing" }
        shot("6-canal-reproduciendo")
        XCTAssertTrue(playing, "el canal no empezó a reproducirse")
        controls(app)
        app.buttons["player.close"].tap()
        XCTAssertTrue(wait(5) { !app.otherElements["player.screen"].exists }, "no se pudo salir del canal")
        shot("7-canal-cerrado")
    }

    /** botón "Reproductor de iOS": el video pasa al reproductor de Apple (con imagen en imagen) y sigue reproduciéndose */
    func testNativePlayer() {
        let app = launch(movie)
        XCTAssertTrue(app.buttons["player.close"].waitForExistence(timeout: 30), "no se abrió el reproductor")
        let toggle = app.buttons["player.toggle"]
        XCTAssertTrue(wait(60) { controls(app); return value(toggle) == "playing" }, "el video no empezó a reproducirse")
        controls(app)
        guard app.buttons["player.pip"].exists else { XCTFail("no hay botón del reproductor de iOS"); return }
        app.buttons["player.pip"].tap()
        let diagPath = (ProcessInfo.processInfo.environment["SHOTS"] ?? "") + "/diag-" + name.filter { $0.isLetter || $0.isNumber } + ".txt"
        func diag() -> String { (try? String(contentsOfFile: diagPath)) ?? "" }
        XCTAssertTrue(wait(10) { !app.otherElements["player.screen"].exists }, "el reproductor de la app no se cerró")
        let playing = wait(40) { diag().contains("nativo: reproduciendo") || diag().contains("nativo: falló") }
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        shot("10-reproductor-ios")
        XCTAssertTrue(playing && diag().contains("nativo: reproduciendo"), "el reproductor de iOS no reprodujo: \(diag())")
    }

    /** servidor que no contesta: la pantalla debe seguir respondiendo y dejar salir al instante */
    func testDeadServerStillLetsYouExit() {
        let app = launch(dead, live: true)
        XCTAssertTrue(app.buttons["player.close"].waitForExistence(timeout: 30), "no se abrió el reproductor")
        RunLoop.current.run(until: Date().addingTimeInterval(4))
        controls(app)
        shot("8-servidor-sin-respuesta")
        let t0 = Date()
        note("toco cerrar")
        app.buttons["player.close"].tap()
        note(String(format: "tap terminado en %.2f s", Date().timeIntervalSince(t0)))
        XCTAssertTrue(wait(5) { !app.otherElements["player.screen"].exists }, "la pantalla quedó pegada con un servidor que no responde")
        XCTAssertLessThan(Date().timeIntervalSince(t0), 6)
        shot("9-servidor-cerrado")
    }
}
