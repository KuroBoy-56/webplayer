import SwiftUI
import AVFoundation

final class AppDelegate: NSObject, UIApplicationDelegate {
    /** el reproductor pide horizontal en iPhone */
    static var orientationLock: UIInterfaceOrientationMask = .all

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        AppDelegate.orientationLock
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Store.boot()
        ErrorReport.boot()
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        return true
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

/** fuerza horizontal (reproductor en iPhone) o vuelve a dejar girar libremente */
func setOrientation(landscape: Bool) {
    let phone = UIDevice.current.userInterfaceIdiom == .phone
    AppDelegate.orientationLock = landscape && phone ? .landscape : .all
    guard let scene = UIApplication.shared.connectedScenes.first(where: { $0 is UIWindowScene }) as? UIWindowScene else { return }
    if #available(iOS 16.0, *) {
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: AppDelegate.orientationLock)) { _ in }
        scene.windows.first?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
    }
}
