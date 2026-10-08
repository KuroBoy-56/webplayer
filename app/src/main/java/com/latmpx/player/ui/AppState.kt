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
}

class AppState {
    var session by mutableStateOf<Session?>(null)
    var tab by mutableStateOf(Tab.HOME)
    val stack = mutableStateListOf<Route>()
    var movieCats by mutableStateOf<List<Category>>(emptyList())
    var seriesCats by mutableStateOf<List<Category>>(emptyList())
    var liveCats by mutableStateOf<List<Category>>(emptyList())
    var movies by mutableStateOf<List<Item>>(emptyList())
    var series by mutableStateOf<List<Item>>(emptyList())
    var live by mutableStateOf<List<Item>>(emptyList())
    var loading by mutableStateOf(false)
    /** cambia cada vez que se vuelve del reproductor, para refrescar "Continuar viendo" */
    var refresh by mutableStateOf(0)

    fun push(r: Route) { stack.add(r) }
    fun pop(): Boolean { if (stack.isEmpty()) return false; stack.removeAt(stack.lastIndex); return true }
}
