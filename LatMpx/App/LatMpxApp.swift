import SwiftUI
import AVFoundation

final class AppDelegate: NSObject, UIApplicationDelegate {
    /** iPhone en vertical (como Android); mientras se ve el reproductor también horizontal. iPad gira libre. */
    static var playerOpen = false

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        guard UIDevice.current.userInterfaceIdiom == .phone else { return .all }
        return AppDelegate.playerOpen ? .allButUpsideDown : .portrait
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Store.boot()
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

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
                .environmentObject(tenant)
                .environmentObject(cloud)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
    }
}
