import Foundation

/**
 * Borrado de caché ordenado desde el panel: check_mac trae "cache_clear" (id de la orden más nueva para esta
 * app) y la petición lleva "cc" (la última ya aplicada, Store.cacheClearSeen). La primera vez solo se guarda;
 * con un id mayor se avisa ~3 s, se borra lo que se vuelve a descargar y RootView reconstruye la raíz
 * (iOS no deja relanzar la app: es lo más parecido a abrirla de nuevo).
 */
final class CacheClear: ObservableObject {
    static let shared = CacheClear()
    /** aviso en pantalla antes de borrar */
    @Published var notice = false
    /** cambia en cada borrado: LatMpxApp vuelve a crear RootView desde cero */
    @Published private(set) var generation = 0

    private static let lock = NSLock()

    /** sin valor guardado: silencio; un id mayor que el guardado: borrar; igual o menor: nada */
    static func shouldClear(seen: Int?, received: Int) -> Bool {
        guard let s = seen else { return false }
        return received > s
    }

    /** respuesta de check_mac con "cache_clear" (cualquier hilo) */
    static func received(_ id: Int) {
        let go: Bool = lock.locked {
            let seen = Store.cacheClearSeen
            let clear = shouldClear(seen: seen, received: id)
            // se guarda antes de borrar para no repetir el borrado en bucle
            if seen == nil || clear { Store.cacheClearSeen = id }
            return clear
        }
        if go { DispatchQueue.main.async { if !CacheClear.shared.notice { CacheClear.shared.notice = true } } }
    }

    /**
     * Lo que se vuelve a descargar: caché HTTP, imágenes, catálogo, detalles, TMDB y carátulas.
     * No toca la sesión del panel, el distribuidor, los ajustes, las descargas ni cache_clear_seen.
     */
    static func wipe() {
        URLCache.shared.removeAllCachedResponses()
        ImageLoader.shared.clear()
        CatalogCache.clear()
        Xtream.clearCache()
        Tmdb.clearCache()
        Posters.clear()
        Actor.clear()
    }

    /** RootView terminó de limpiar: se quita el aviso y se vuelve a crear la raíz */
    func restarted() {
        notice = false
        generation += 1
    }

    #if DEBUG
    /** autocomprobación de la decisión (la compilación Debug de la prueba del simulador la corre al abrir) */
    static func selfCheck() {
        assert(!shouldClear(seen: nil, received: 7), "primera vez: solo se guarda")
        assert(shouldClear(seen: 3, received: 4), "orden nueva: se borra")
        assert(!shouldClear(seen: 4, received: 4), "misma orden: nada")
        assert(!shouldClear(seen: 5, received: 4), "orden vieja: nada")
    }
    #endif
}
