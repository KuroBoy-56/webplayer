package com.latmpx.player.ui

import com.latmpx.player.tr
import com.latmpx.player.R
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.latmpx.player.data.Category
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Platform
import com.latmpx.player.data.Session
import com.latmpx.player.data.Kids
import com.latmpx.player.data.Profiles
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

enum class Tab(private val res: Int) {
    HOME(R.string.tab_home), MOVIES(R.string.movies), SERIES(R.string.series), LIVE(R.string.live_tv), SPORTS(R.string.sports), MYLIST(R.string.my_list), SEARCH(R.string.search), ACCOUNT(R.string.account);
    /** nombre en el idioma de la app */
    val label: String get() = tr(res)
}

/** Pantallas que se apilan sobre las pestañas (atrás vuelve a la anterior). */
sealed class Route {
    data class Detail(val item: Item) : Route()
    data class Browse(val title: String, val kind: Kind, val categoryIds: Set<String>) : Route()
    data class PlatformPage(val platform: Platform) : Route()
    /** actor del elenco: tmdbId 0 = se busca por nombre en TMDB */
    data class ActorPage(val name: String, val tmdbId: Int = 0, val photo: String = "") : Route()
    /** rejilla completa de "Continuar viendo" (true) o de "Mi lista" (false) */
    data class Saved(val continueWatching: Boolean) : Route()
    /** Cuenta › Mis descargas (celular) */
    data object Downloads : Route()
    /** «Categorías» (con perfiles): Explorar como la del web player */
    /**
     * Explorar, como browse.php del web player. «Ver todo» de una fila la abre con su filtro: type 0 todo / 1 películas /
     * 2 series; sort 0 Agregados recientemente / 1 A - Z / 2 Mejor valorados; genre = nombre del género; platform = clave;
     * cat + catKind ("m" / "s") = una carpeta del servidor.
     */
    data class Explore(val type: Int = 0, val sort: Int = 0, val genre: String = "", val platform: String = "", val cat: String = "", val catKind: String = "") : Route()
}

class AppState {
    var session by mutableStateOf<Session?>(null)
    var tab by mutableStateOf(Tab.HOME)
    val stack = mutableStateListOf<Route>()
    /** celular: video a pantalla completa (se ocultan la barra inferior y las del sistema) */
    var immersive by mutableStateOf(false)
    var movieCats by mutableStateOf<List<Category>>(emptyList())
    var seriesCats by mutableStateOf<List<Category>>(emptyList())
    var liveCats by mutableStateOf<List<Category>>(emptyList())
    var movies by mutableStateOf<List<Item>>(emptyList())
    var series by mutableStateOf<List<Item>>(emptyList())
    var live by mutableStateOf<List<Item>>(emptyList())
    var loading by mutableStateOf(false)
    /** el catálogo (películas, series y canales) todavía se está bajando del servidor */
    var catalogLoading by mutableStateOf(false)
    /** cambia cada vez que se vuelve del reproductor, para refrescar "Continuar viendo" */
    var refresh by mutableStateOf(0)
    /** Cuenta › «Actualizar catálogo» (como Roku): cada toque sube el número y AppRoot vuelve a bajar todo del servidor */
    var catalogRev by mutableStateOf(0)
    /** esa actualización está en curso (el botón dice «Actualizando el catálogo…» y no se repite) */
    var catalogReloading by mutableStateOf(false)

    /** false si ya se está actualizando */
    fun reloadCatalog(): Boolean {
        if (catalogReloading || session == null) return false
        catalogReloading = true
        catalogRev++
        return true
    }

    /* ---------- perfiles (docs/PERFILES.md del panel) ---------- */
    /** pantalla de perfiles abierta: false = elegir, true = administrar (null = cerrada) */
    var profilesOpen by mutableStateOf<Boolean?>(null)
    /** abierta desde Cuenta (Atrás vuelve a la app) o al entrar (Atrás sale de la app) */
    var profilesFromAccount by mutableStateOf(false)
    /** lo último que mandó el panel (api/profiles.php) */
    var profilesData by mutableStateOf<Profiles.State?>(null)
    /** el perfil ya se eligió (o no hay perfiles): ya se pueden leer Continuar viendo y Mi lista */
    var profileReady by mutableStateOf(false)
    /** el perfil recién elegido: su avatar en el centro con el circulito hasta que Inicio está listo (ProfileEnter.kt) */
    var entering by mutableStateOf<com.latmpx.player.data.Profiles.Profile?>(null)

    fun openProfiles(manage: Boolean) {
        profilesFromAccount = true
        profilesOpen = manage
    }

    /* ---------- catálogo completo y lo que se ve (perfil infantil: Kids.kt) ---------- */
    private var allMovieCats: List<Category> = emptyList()
    private var allSeriesCats: List<Category> = emptyList()
    private var allLiveCats: List<Category> = emptyList()
    private var allMovies: List<Item> = emptyList()
    private var allSeries: List<Item> = emptyList()
    private var allLive: List<Item> = emptyList()
    /** claves de lo que se ve (con un perfil infantil, una ficha de otra cosa no se abre) */
    @Volatile private var shownKeys: Set<String> = emptySet()

    /**
     * Filas de Inicio, Películas y Series (ordenar y filtrar todo el catálogo): se guardan mientras sus datos son los
     * mismos. Antes cada vez que se pulsaba Inicio se volvía a ordenar el catálogo entero y la pantalla tardaba en abrir.
     */
    private val memo = HashMap<String, Pair<List<Any?>, Any?>>()

    @Suppress("UNCHECKED_CAST")
    fun <T> cached(name: String, vararg keys: Any?, f: () -> T): T {
        val k = keys.toList()
        memo[name]?.let { (old, v) -> if (old == k) return v as T } // el mismo catálogo: es la misma lista (comparación inmediata)
        return f().also { memo[name] = k to it }
    }

    /** llegó el catálogo de un tipo (del equipo o del servidor): se guarda completo y se arma lo que se ve */
    suspend fun putCatalog(kind: Kind, cats: List<Category>, items: List<Item>) {
        when (kind) {
            Kind.MOVIE -> { if (cats.isNotEmpty()) allMovieCats = cats; allMovies = items }
            Kind.SERIES -> { if (cats.isNotEmpty()) allSeriesCats = cats; allSeries = items }
            Kind.LIVE -> { if (cats.isNotEmpty()) allLiveCats = cats; allLive = items }
        }
        showKind(kind)
    }

    /** el perfil cambió o llegaron veredictos de TMDB: se vuelve a armar todo lo que se ve */
    suspend fun applyKids() {
        showKind(Kind.MOVIE); showKind(Kind.SERIES); showKind(Kind.LIVE)
    }

    /** cada armado de un tipo lleva un número: uno viejo que termina después de uno nuevo no pisa lo nuevo */
    private val showGen = IntArray(3)

    private suspend fun showKind(kind: Kind) {
        val gen = ++showGen[kind.ordinal]
        val cats = when (kind) { Kind.MOVIE -> allMovieCats; Kind.SERIES -> allSeriesCats; Kind.LIVE -> allLiveCats }
        val items = when (kind) { Kind.MOVIE -> allMovies; Kind.SERIES -> allSeries; Kind.LIVE -> allLive }
        val kids = Profiles.kids
        val shown = when {
            !kids -> cats to items
            // perfil infantil sin catálogo todavía: nada (nunca las categorías sin filtrar)
            items.isEmpty() -> emptyList<Category>() to items
            else -> withContext(Dispatchers.Default) { Kids.filter(kind, cats, items) }
        }
        if (gen != showGen[kind.ordinal]) return
        when (kind) {
            Kind.MOVIE -> { if (shown.first.isNotEmpty() || kids) movieCats = shown.first; movies = shown.second }
            Kind.SERIES -> { if (shown.first.isNotEmpty() || kids) seriesCats = shown.first; series = shown.second }
            Kind.LIVE -> { if (shown.first.isNotEmpty() || kids) liveCats = shown.first; live = shown.second }
        }
        shownKeys = if (kids) (movies + series + live).mapTo(HashSet()) { it.key } else emptySet()
    }

    /** perfil infantil: ¿se puede abrir? (sin perfil infantil, todo) */
    fun allowed(item: Item): Boolean = !Profiles.kids || item.key in shownKeys

    /** perfil infantil sin canales de niños en la lista: TV en vivo no aparece */
    val hideLive: Boolean get() = Profiles.kids && live.isEmpty() && !catalogLoading

    fun push(r: Route) {
        // lo que no pasa el filtro infantil no se abre aunque llegue por otro camino (Continuar viendo de otro equipo…)
        if (r is Route.Detail && !allowed(r.item)) return
        stack.add(r)
    }
    fun pop(): Boolean { if (stack.isEmpty()) return false; stack.removeAt(stack.lastIndex); return true }
}
