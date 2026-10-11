import SwiftUI
import UIKit

/**
 * El reproductor lo presenta UIKit (no fullScreenCover): en iPhone la pantalla pide solo horizontal y
 * el sistema la gira al abrirla y vuelve a vertical al cerrarla, sin forzar la escena a mano
 * (forzarla dejaba los toques desplazados: no se podía pausar, adelantar ni salir).
 */
private final class PlayerHostController: UIHostingController<AnyView> {
    private var phone: Bool { UIDevice.current.userInterfaceIdiom == .phone }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { phone ? .landscape : .all }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation {
        guard phone else { return super.preferredInterfaceOrientationForPresentation }
        // el lado hacia el que ya está girado el teléfono
        return UIDevice.current.orientation == .landscapeRight ? .landscapeLeft : .landscapeRight
    }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var childForHomeIndicatorAutoHidden: UIViewController? { nil }
}

@MainActor
enum PlayerPresenter {
    private static weak var host: UIViewController?
    private static var shownId: UUID?

    /** muestra u oculta el reproductor según state.play */
    static func sync(_ state: AppState, _ tenant: Tenant) {
        let req = state.play
        if req?.id == shownId { return }
        if let h = host {
            shownId = nil
            host = nil
            PlayerDiag.log("dismiss")
            h.dismiss(animated: true) {
                PlayerDiag.log("dismiss terminado")
                if let r = state.play { present(r, state, tenant) } else { restoreOrientation() }
            }
            return
        }
        if let r = req { present(r, state, tenant) }
    }

    private static func present(_ req: PlayRequest, _ state: AppState, _ tenant: Tenant) {
        guard let top = topController() else { return }
        let view = PlayerScreen(request: req)
            .environmentObject(state)
            .environmentObject(tenant)
            .environmentObject(Cloud.shared)
            .preferredColorScheme(.dark)
            .tint(Theme.accent)
        let h = PlayerHostController(rootView: AnyView(view))
        h.modalPresentationStyle = .fullScreen
        h.overrideUserInterfaceStyle = .dark
        h.view.backgroundColor = .black
        AppDelegate.playerOpen = true
        shownId = req.id
        host = h
        top.present(h, animated: true)
        // si justo se estaba cerrando otra ventana (menú, hoja) la presentación no ocurre: se reintenta una vez
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
            guard shownId == req.id, h.presentingViewController == nil, let t = topController(), t !== h else { return }
            t.present(h, animated: true)
        }
    }

    /** de vuelta en la app: iPhone en vertical (igual que Android), iPad gira libre */
    private static func restoreOrientation() {
        AppDelegate.playerOpen = false
        guard UIDevice.current.userInterfaceIdiom == .phone else { return }
        guard let scene = UIApplication.shared.connectedScenes.first(where: { $0 is UIWindowScene }) as? UIWindowScene else { return }
        scene.windows.first?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) { _ in }
    }

    private static func topController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.first { $0.activationState == .foregroundActive && $0 is UIWindowScene } as? UIWindowScene
            ?? UIApplication.shared.connectedScenes.first { $0 is UIWindowScene } as? UIWindowScene
        let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
        var top = window?.rootViewController
        while let p = top?.presentedViewController, !p.isBeingDismissed { top = p }
        return top
    }
}
