package com.latmpx.player.data

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import com.latmpx.player.R
import com.latmpx.player.tr
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

/**
 * Avisos de partidos: los equipos favoritos (Ajustes, por línea y perfil) y los partidos marcados en Deportes (mantener
 * presionada la tarjeta). Cada partido avisa 30 min antes («va a empezar»), 10 min antes («está por comenzar») y al
 * empezar («ya está en vivo»). Con la app abierta no sale la notificación del sistema: solo queda en la campanita, que
 * guarda todo 24 h. Los partidos salen de los próximos 21 días del panel (api/sports_fixtures.php): nunca TheSportsDB.
 * Las alarmas sobreviven a cerrar la app y a reiniciar (MatchAlertReceiver con BOOT_COMPLETED); sin permiso de alarmas
 * exactas (Android 12+) se usan las normales, que pueden llegar unos minutos tarde. Con perfiles todo queda también en la
 * nube (MatchAlertsCloud, api/alerts.php): lo que se marca en la TV o en la computadora avisa en este celular.
 */
object MatchAlerts {
    data class Team(val name: String, val label: String, val badge: String, val league: String, val sport: String)
    data class Bell(val at: Long, val title: String, val text: String)

    private const val CHANNEL = "match_alerts"
    private const val STAGES = "30,10,0"
    private const val MAX_ALARMS = 90
    private lateinit var prefs: SharedPreferences
    private lateinit var app: Context

    /** sube con cada cambio: la campanita y Ajustes se vuelven a dibujar */
    var rev by mutableIntStateOf(0)
        private set

    fun init(ctx: Context) {
        app = ctx.applicationContext
        prefs = ctx.getSharedPreferences("match_alerts", Context.MODE_PRIVATE)
    }

    // ---------- equipos y partidos elegidos (por línea y perfil) ----------

    /** línea y perfil de ahora (la parte de las claves que cambia con cada perfil) */
    fun suffix(): String = Tenant.code + "|" + (Store.session()?.let { it.user + "@" + it.base } ?: "-") + "|" + (Profiles.current?.id ?: "")

    private fun key(base: String, sfx: String = suffix()) = "$base|$sfx"

    fun teams(): List<Team> = arr(prefs.getString(key("teams"), null)).mapObj {
        Team(it.optString("n"), it.optString("l"), it.optString("b"), it.optString("lg"), it.optString("sp"))
    }

    fun setTeams(list: List<Team>) {
        val a = JSONArray(list.map {
            JSONObject().put("n", it.name).put("l", it.label).put("b", it.badge).put("lg", it.league).put("sp", it.sport)
        })
        prefs.edit().putString(key("teams"), a.toString()).apply()
        changed()
        MatchAlertsCloud.push(JSONObject().put("action", "set_teams").put("teams", JSONArray(a.toString())))
    }

    /** partidos marcados en Deportes: id -> JSON del partido (para avisar aunque ya no esté en la agenda) */
    private fun marked(): JSONObject = runCatching { JSONObject(prefs.getString(key("events"), "{}")!!) }.getOrDefault(JSONObject())

    fun isMarked(id: String): Boolean = marked().has(id)

    /** activa o quita el aviso de un partido; true = quedó activado */
    /** activar el aviso solo vale si faltan más de 5 minutos para que empiece (quitarlo, siempre; el panel dice 409 too_late) */
    fun tooLate(e: SportEvent, now: Long = System.currentTimeMillis()): Boolean = e.start <= now + 5 * 60_000L

    fun toggle(e: SportEvent): Boolean {
        val m = marked()
        val on = !m.has(e.id)
        if (on && tooLate(e)) return false
        if (on) m.put(e.id, JSONObject().put("t", title(e)).put("s", e.start).put("sp", e.sport)) else m.remove(e.id)
        prefs.edit().putString(key("events"), m.toString()).apply()
        changed()
        // también en la nube: la computadora, la TV y otro celular de la misma línea y perfil lo ven
        MatchAlertsCloud.push(JSONObject().put("action", "event").put("id", e.id).put("on", on)
            .put("event", JSONObject().put("t", title(e)).put("s", e.start).put("h", e.home).put("a", e.away)))
        return on
    }

    fun title(e: SportEvent): String = if (e.home.isNotBlank() && e.away.isNotBlank()) "${e.home} vs ${e.away}" else e.title.ifBlank { e.league }

    private fun changed() {
        rev++
        schedule(SportsPanel.cachedFixtures())
    }

    // ---------- alarmas ----------

    /**
     * Programa los avisos de los partidos de los equipos favoritos (en los 21 días del panel) y de los marcados. Lo
     * que se programa queda guardado aparte del perfil: al reiniciar el equipo se vuelve a programar lo mismo.
     */
    fun schedule(fx: Fixtures?) {
        if (!::prefs.isInitialized) return
        val m = marked()
        val now = System.currentTimeMillis()
        // el marcado ya pasó: se olvida
        m.keys().asSequence().toList().forEach { id -> if ((m.optJSONObject(id)?.optLong("s") ?: 0) < now - 3 * 3600_000L) m.remove(id) }
        val names = teams().map { it.name }
        // a_*: lo del perfil abierto, para la actualización de fondo (cada hora baja de la nube lo de ese perfil)
        prefs.edit().putString(key("events"), m.toString()).putString("a_teams", JSONArray(names).toString()).putString("a_marked", m.toString())
            .putString("a_suffix", suffix()).putString("a_prof", Profiles.param()).putBoolean("a_cloud", Profiles.current != null).apply()
        arm(build(fx, names.toSet(), m), names.isNotEmpty() || Profiles.current != null)
    }

    // ---------- nube (MatchAlertsCloud) ----------

    /** lo que bajó de la nube para la línea y perfil «sfx»: reemplaza lo de aquí y se vuelve a programar */
    internal fun applyCloud(teams: JSONArray?, events: JSONObject?, sfx: String) {
        if (!::prefs.isInitialized) return
        val t = teams ?: JSONArray()
        val m = JSONObject()
        events?.keys()?.forEach { id ->
            val o = events.optJSONObject(id) ?: return@forEach
            m.put(id, JSONObject().put("t", o.optString("t")).put("s", o.optLong("s")))
        }
        if (t.toString() == prefs.getString(key("teams", sfx), "[]") && m.toString() == prefs.getString(key("events", sfx), "{}")) return
        prefs.edit().putString(key("teams", sfx), t.toString()).putString(key("events", sfx), m.toString()).apply()
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            if (sfx == suffix()) changed()
            else if (sfx == prefs.getString("a_suffix", null)) {
                val names = t.objs().map { it.optString("n") }
                prefs.edit().putString("a_teams", JSONArray(names).toString()).putString("a_marked", m.toString()).apply()
                refreshFromActive()
            }
        }
    }

    internal fun enqueue(op: JSONObject) {
        val q = arr(prefs.getString("cloud_q", null))
        q.put(op)
        // nunca más de 100 pendientes (los más viejos se pierden)
        val list = q.objs().takeLast(100)
        prefs.edit().putString("cloud_q", JSONArray(list).toString()).apply()
    }

    internal fun pendingFirst(): JSONObject? = arr(prefs.getString("cloud_q", null)).optJSONObject(0)

    internal fun pendingDrop() {
        val q = arr(prefs.getString("cloud_q", null)).objs().drop(1)
        prefs.edit().putString("cloud_q", JSONArray(q).toString()).apply()
    }

    /** actualización de fondo: lo del último perfil abierto en la nube ("" si no hay perfiles) */
    internal fun activeProfile(): Pair<String, String>? =
        if (::prefs.isInitialized && prefs.getBoolean("a_cloud", false)) prefs.getString("a_prof", "")!! to prefs.getString("a_suffix", "")!! else null

    /** actualización de fondo (sin perfil abierto): los equipos y partidos de la última vez, con la lista nueva del panel */
    fun refreshFromActive() {
        if (!::prefs.isInitialized) return
        val names = arr(prefs.getString("a_teams", null)).let { a -> (0 until a.length()).map { a.optString(it) }.toSet() }
        val m = runCatching { JSONObject(prefs.getString("a_marked", "{}")!!) }.getOrDefault(JSONObject())
        arm(build(SportsPanel.cachedFixtures(), names, m), names.isNotEmpty() || prefs.getBoolean("a_cloud", false))
    }

    /** vuelve a programar lo último guardado (al reiniciar el equipo o al actualizar la app) */
    fun rearm() {
        if (::prefs.isInitialized) arm(arr(prefs.getString("active", null)), prefs.getBoolean("refresh", false))
    }

    /** partidos a avisar: los de los equipos favoritos (21 días del panel) y los marcados, sin repetir */
    private fun build(fx: Fixtures?, names: Set<String>, m: JSONObject): JSONArray {
        val list = JSONArray()
        val seen = HashSet<String>()
        fx?.events?.forEach { e ->
            if (!e.postponed && (e.home in names || e.away in names) && seen.add(e.id)) list.put(JSONObject().put("id", e.id).put("t", title(e)).put("s", e.start))
        }
        m.keys().forEach { id ->
            val o = m.optJSONObject(id) ?: return@forEach
            if (seen.add(id)) list.put(JSONObject().put("id", id).put("t", o.optString("t")).put("s", o.optLong("s")))
        }
        prefs.edit().putString("active", list.toString()).apply()
        return list
    }

    private fun arm(list: JSONArray, refresh: Boolean) {
        val am = app.getSystemService(AlarmManager::class.java) ?: return
        val now = System.currentTimeMillis()
        val old = prefs.getString("codes", "")!!.split(',').mapNotNull { it.toIntOrNull() }
        old.forEach { am.cancel(pi(it, null)) }
        val codes = ArrayList<Int>()
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        list.objs().sortedBy { it.optLong("s") }.forEach { o ->
            val start = o.optLong("s")
            for (stage in STAGES.split(',').map { it.toInt() }) {
                val at = start - stage * 60_000L
                if (at <= now || codes.size >= MAX_ALARMS) continue
                val code = (o.optString("id") + "|" + stage).hashCode()
                val intent = Intent(app, MatchAlertReceiver::class.java).setAction(ACTION_ALERT)
                    .putExtra("id", o.optString("id")).putExtra("t", o.optString("t")).putExtra("stage", stage)
                val p = pi(code, intent)
                runCatching {
                    if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p) else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p)
                    codes += code
                }
            }
        }
        // con perfiles (o equipos favoritos): cada hora se bajan los avisos de la nube (lo que se marcó en la TV o en la
        // computadora) y se vuelve a pedir la lista de partidos al panel
        val r = pi(REFRESH_CODE, Intent(app, MatchAlertReceiver::class.java).setAction(ACTION_REFRESH))
        am.cancel(r)
        if (refresh) am.setInexactRepeating(AlarmManager.RTC, now + AlarmManager.INTERVAL_HOUR, AlarmManager.INTERVAL_HOUR, r)
        prefs.edit().putString("codes", codes.joinToString(",")).putBoolean("refresh", refresh).apply()
    }

    private fun pi(code: Int, intent: Intent?): PendingIntent = PendingIntent.getBroadcast(
        app, code, intent ?: Intent(app, MatchAlertReceiver::class.java).setAction(ACTION_ALERT),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** ¿las alarmas llegan a la hora exacta? (Android 12+ lo pide en Ajustes del sistema) */
    fun exactAllowed(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
        app.getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() == true

    // ---------- campanita (24 h) ----------

    fun bell(): List<Bell> {
        val cut = System.currentTimeMillis() - 24 * 3600_000L
        return arr(prefs.getString("bell", null)).objs().map { Bell(it.optLong("at"), it.optString("t"), it.optString("x")) }
            .filter { it.at >= cut }.sortedByDescending { it.at }
    }

    fun unread(): Int = bell().count { it.at > prefs.getLong("bell_seen", 0) }

    fun markRead() {
        prefs.edit().putLong("bell_seen", System.currentTimeMillis()).apply()
        rev++
    }

    private fun addBell(title: String, text: String) {
        val list = bell().take(99).map { JSONObject().put("at", it.at).put("t", it.title).put("x", it.text) }
        prefs.edit().putString("bell", JSONArray(listOf(JSONObject().put("at", System.currentTimeMillis()).put("t", title).put("x", text)) + list).toString()).apply()
        rev++
    }

    /** el aviso llegó: siempre a la campanita; a la barra de notificaciones solo con la app cerrada o en segundo plano */
    internal fun fire(ctx: Context, id: String, title: String, stage: Int) {
        val text = when (stage) {
            30 -> tr(R.string.ma_30)
            10 -> tr(R.string.ma_10)
            else -> tr(R.string.ma_live)
        }
        addBell(title, text)
        if (com.latmpx.player.App.foreground) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, tr(R.string.ma_channel), NotificationManager.IMPORTANCE_HIGH))
        }
        val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
            PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title).setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_EVENT)
            .setAutoCancel(true).setContentIntent(open).build()
        runCatching { nm.notify(id.hashCode(), n) } // sin permiso de notificaciones no sale (queda en la campanita)
    }

    // ---------- util ----------

    const val ACTION_ALERT = "com.latmpx.player.MATCH_ALERT"
    const val ACTION_REFRESH = "com.latmpx.player.MATCH_REFRESH"
    private const val REFRESH_CODE = 777_001

    private fun arr(raw: String?): JSONArray = runCatching { JSONArray(raw ?: "[]") }.getOrDefault(JSONArray())
    private fun JSONArray.objs(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
    private fun <T> JSONArray.mapObj(f: (JSONObject) -> T?): List<T> = objs().mapNotNull(f)
}

/** las alarmas de los avisos, el reinicio del equipo y la actualización de fondo (avisos de la nube y partidos, cada hora) */
class MatchAlertReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            MatchAlerts.ACTION_ALERT -> MatchAlerts.fire(ctx, intent.getStringExtra("id").orEmpty(), intent.getStringExtra("t").orEmpty(), intent.getIntExtra("stage", 0))
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> MatchAlerts.rearm()
            MatchAlerts.ACTION_REFRESH -> {
                val done = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        MatchAlerts.activeProfile()?.let { (prof, sfx) -> withTimeoutOrNull(12_000) { runCatching { MatchAlertsCloud.sync(prof, sfx) } } }
                        withTimeoutOrNull(25_000) { SportsPanel.fixtures(0) }
                        MatchAlerts.refreshFromActive()
                    } finally { done.finish() }
                }
            }
        }
    }
}
