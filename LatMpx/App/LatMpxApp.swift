import SwiftUI
import AVFoundation

final class AppDelegate: NSObject, UIApplicationDelegate {
    /** iPhone en vertical (como Android); mientras se ve el reproductor también horizontal. iPad gira libre. */
    static var playerOpen = false
    /** tema de prueba del panel: en el iPhone siempre en horizontal */
    static var reviewOpen = false

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        guard UIDevice.current.userInterfaceIdiom == .phone else { return .all }
        if AppDelegate.reviewOpen { return .landscape }
        return AppDelegate.playerOpen ? .allButUpsideDown : .portrait
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Store.boot()
        #if DEBUG
        CacheClear.selfCheck()
        PanelImg.selfCheck()
        #endif
        ErrorReport.boot()
        Integrity.check()
        PlayerDiag.watchdog()
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        Downloads.shared.boot() // descargas para ver sin internet (siguen las que el sistema tenga en curso)
        return true
    }

    /** descargas que terminaron con la app cerrada: iOS la despierta para guardar los archivos */
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == Downloads.sessionId else { completionHandler(); return }
        Downloads.shared.backgroundDone = completionHandler
        Downloads.shared.boot()
    }
}

@main
struct LatMpxApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var state = AppState()
    @StateObject private var tenant = Tenant.shared
    @StateObject private var cloud = Cloud.shared
    /** borrado de caché del panel: la raíz se vuelve a crear desde cero (iOS no deja relanzar la app) */
    @StateObject private var cacheClear = CacheClear.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .id(cacheClear.generation)
                .environmentObject(state)
                .environmentObject(tenant)
                .environmentObject(cloud)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
    }
}
