package com.latmpx.player.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.latmpx.player.data.Category
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Platform
import com.latmpx.player.data.Session

enum class Tab(val label: String) { HOME("Inicio"), MOVIES("Películas"), SERIES("Series"), LIVE("TV en vivo"), SPORTS("Deportes"), MYLIST("Mi lista"), SEARCH("Buscar"), ACCOUNT("Cuenta") }

/** Pantallas que se apilan sobre las pestañas (atrás vuelve a la anterior). */
sealed class Route {
    data class Detail(val item: Item) : Route()
    data class Browse(val title: String, val kind: Kind, val categoryIds: Set<String>) : Route()
    data class PlatformPage(val platform: Platform) : Route()
    /** actor del elenco: tmdbId 0 = se busca por nombre en TMDB */
    data class ActorPage(val name: String, val tmdbId: Int = 0, val photo: String = "") : Route()
    /** rejilla completa de "Continuar viendo" (true) o de "Mi lista" (false) */
    data class Saved(val continueWatching: Boolean) : Route()
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
    /** cambia cada vez que se vuelve del reproductor, para refrescar "Continuar viendo" */
    var refresh by mutableStateOf(0)
    /** TV: sección cuya cartelera ya tomó el foco (así no lo roba al volver a verse al hacer scroll) */
    var billboardFocusedTab: Tab? = null
    /** TV: el menú superior (transparente sobre el destacado) se oculta al bajar por las filas, como Netflix para TV */
    var tvHeaderHidden by mutableStateOf(false)
    /** TV: al aumentar, Inicio / Series / Películas vuelven arriba (atrás desde las filas) */
    var tvScrollTop by mutableStateOf(0)

    fun push(r: Route) { stack.add(r) }
    fun pop(): Boolean { if (stack.isEmpty()) return false; stack.removeAt(stack.lastIndex); return true }
}
