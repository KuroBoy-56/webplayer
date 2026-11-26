package com.latmpx.player.data

import com.latmpx.player.R
import com.latmpx.player.tr
import com.latmpx.player.ui.screens.SpStatus
import com.latmpx.player.ui.screens.spStatus
import com.latmpx.player.ui.screens.spTime
import java.util.Calendar

/**
 * La campanita de la TV (solo con perfiles): los partidos de HOY (zona del panel) de los equipos favoritos y de los
 * partidos marcados, con la agenda del panel y, si hay, los marcadores en vivo. En la TV no hay notificaciones: el aviso
 * es este mensajito al entrar y la lista al tocar la campanita (las notificaciones las da la app del celular).
 */
object TvBell {
    data class Msg(val key: String, val text: String, val order: Int, val start: Long)

    private fun day(t: Long): Int = Calendar.getInstance(Sports.zone).apply { timeInMillis = t }.let { it.get(Calendar.YEAR) * 1000 + it.get(Calendar.DAY_OF_YEAR) }

    /** los mensajes de hoy: primero los que se juegan, después los que faltan (por hora) y al final los terminados */
    fun messages(agenda: SportsData?, live: SportsLive.Data?, now: Long = System.currentTimeMillis()): List<Msg> {
        val teams = MatchCloud.teams.map { Platforms.fold(it) }.toSet()
        val marked = MatchCloud.markedList.associateBy { it.id }
        if (teams.isEmpty() && marked.isEmpty()) return emptyList()
        val byId = LinkedHashMap<String, SportEvent>()
        agenda?.events?.forEach { byId[it.id] = it }
        // el marcador en vivo es más nuevo que el de la agenda
        live?.events?.forEach { e -> byId[e.id] = byId[e.id]?.let { a -> if (e.soon) a else a.copy(homeScore = e.homeScore, awayScore = e.awayScore, status = e.status) } ?: e }
        val today = day(now)
        val out = ArrayList<Msg>()
        for (e in byId.values) {
            if (day(e.start) != today) continue
            val mine = e.id in marked || Platforms.fold(e.home) in teams || Platforms.fold(e.away) in teams
            if (!mine) continue
            val who = if (e.home.isNotBlank() && e.away.isNotBlank()) "${e.home} vs ${e.away}" else e.title.ifBlank { e.league }
            val score = if (e.home.isNotBlank() && e.away.isNotBlank() && e.homeScore.isNotBlank() && e.awayScore.isNotBlank()) "${e.home} ${e.homeScore}-${e.awayScore} ${e.away}" else who
            val info = agenda?.sports?.get(e.sport) ?: live?.sports?.get(e.sport)
            out += when (spStatus(e, info, now)) {
                SpStatus.LIVE -> Msg(e.id, tr(R.string.tb_live, score), 0, e.start)
                SpStatus.FIN -> Msg(e.id, tr(R.string.tb_final, score), 2, e.start)
                SpStatus.POSTPONED -> continue
                SpStatus.SOON -> Msg(e.id, tr(R.string.tb_today, spTime(e.start), who), 1, e.start)
            }
        }
        // marcados que la agenda ya no trae (otro día de la semana pasada no): solo si son de hoy y faltan
        for (m in marked.values) if (m.id !in byId && day(m.start) == today && m.start > now) out += Msg(m.id, tr(R.string.tb_today, spTime(m.start), m.title), 1, m.start)
        return out.sortedWith(compareBy({ it.order }, { if (it.order == 2) -it.start else it.start }))
    }
}
