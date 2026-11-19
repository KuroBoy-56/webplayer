package com.latmpx.player.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.text.Normalizer

/**
 * Perfil infantil (docs/PERFILES.md del panel, sección 5): solo contenido para niños y de Disney. Las reglas son las del
 * panel («kidsRules» de api/profiles.php, las mismas en todas las apps; se guardan en el equipo) o la copia de fábrica
 * ([KidsRules]). El catálogo completo nunca se recorta: [filter] arma lo que se ve (AppState.showKind) y lo dudoso se
 * le pregunta al panel en segundo plano ([askPending], api/kids_rate.php: clasificación de edad de TMDB).
 */
object Kids {
    private var dir: File? = null

    /** cambia cuando llegan veredictos nuevos de TMDB: la interfaz vuelve a armar lo que se ve */
    var rev by mutableIntStateOf(0)
        private set

    fun init(ctx: Context) { dir = ctx.applicationContext.filesDir }

    /* ---------- reglas ---------- */

    private class Rx(val list: List<Regex>) {
        fun m(t: String): Boolean = t.isNotEmpty() && list.any { it.containsMatchIn(t) }
    }

    private class Compiled(val v: Int, private val lists: Map<String, Rx>) {
        fun m(name: String, t: String): Boolean = lists[name]?.m(t) == true
    }

    @Volatile private var compiled: Compiled? = null
    private val NAMES = listOf("kids", "family", "live", "disney", "block_cats", "kids_strong", "genre_kids", "genre_weak", "genre_anim", "genre_hard", "genre_block", "block_marks", "block_titles")
    private val REQUIRED = listOf("kids", "live", "disney", "block_cats", "kids_strong", "genre_kids", "genre_block", "block_marks", "block_titles")

    private fun valid(r: JSONObject?): Boolean = r != null && r.has("v") && REQUIRED.all { r.optJSONArray(it) != null }

    private fun rulesFile(): File? = dir?.let { File(it, "kids_rules.json") }

    /** las reglas que mandó el panel (api/profiles.php) */
    fun saveRules(r: JSONObject) {
        if (!valid(r)) return
        runCatching { rulesFile()?.writeText(r.toString(), Charsets.UTF_8) }
        compiled = null
    }

    private fun rules(): JSONObject {
        val local = JSONObject(KidsRules.LOCAL)
        val saved = runCatching { rulesFile()?.takeIf { it.exists() }?.readText(Charsets.UTF_8)?.let { JSONObject(it) } }.getOrNull()
        return if (valid(saved) && saved!!.optInt("v") >= local.optInt("v")) saved else local
    }

    private fun comp(): Compiled = compiled ?: compile(rules()).also { compiled = it }

    /** una lista como una sola expresión (rápido con miles de títulos); «/…/» es una expresión regular, lo demás «contiene» */
    private fun compile(r: JSONObject): Compiled {
        val out = HashMap<String, Rx>()
        for (name in NAMES) {
            val arr = r.optJSONArray(name) ?: JSONArray()
            val parts = ArrayList<String>()
            for (i in 0 until arr.length()) {
                val e = arr.optString(i)
                if (e.length > 2 && e.startsWith("/") && e.endsWith("/")) parts += "(?:" + e.substring(1, e.length - 1) + ")"
                else if (e.isNotEmpty()) parts += Regex.escape(norm(e))
            }
            val one = runCatching { Regex(parts.joinToString("|")) }.getOrNull()
            out[name] = when {
                parts.isEmpty() -> Rx(emptyList())
                one != null -> Rx(listOf(one))
                // una entrada rara del panel: una por una, sin la que no compila
                else -> Rx(parts.mapNotNull { p -> runCatching { Regex(p) }.getOrNull() })
            }
        }
        return Compiled(r.optInt("v"), out)
    }

    /** minúsculas y sin acentos (á→a, ñ→n…), como la web */
    fun norm(s: String): String =
        Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")

    /** "block" | "kids" | "disney" | "family" | "" para el nombre de una categoría (en vivo solo "block", "kids" o "") */
    private fun catClass(c: Compiled, name: String, live: Boolean): String {
        val n = norm(name)
        if (n.isEmpty()) return ""
        if (c.m("block_cats", n) && !c.m("kids_strong", n)) return "block"
        if (live) return if (c.m("live", n)) "kids" else ""
        if (c.m("kids", n)) return "kids"
        if (c.m("disney", n)) return "disney"
        if (c.m("family", n)) return "family"
        return ""
    }

    private class Genre(val weak: Boolean, val kids: Boolean, val hard: Boolean, val block: Boolean)

    /** "strong" (se ve salvo que TMDB diga «no»), "weak" (solo si TMDB dice «ok») o "" (nunca): wp_kids_item_level() de la web */
    private fun level(c: Compiled, cls: String, x: Item, memo: HashMap<String, Genre>): String {
        if (cls == "block") return ""
        val kidsCat = cls == "kids"
        val weakCat = cls == "disney" || cls == "family"
        val g = if (x.genre.isEmpty()) null else memo.getOrPut(x.genre) {
            val t = norm(x.genre)
            val weak = c.m("genre_weak", t)
            Genre(weak, c.m("genre_kids", t) || (weak && c.m("genre_anim", t)), c.m("genre_hard", t), c.m("genre_block", t))
        }
        val gWeak = g?.weak == true
        val gKids = g?.kids == true
        val gHard = g?.hard == true
        val gBlock = g?.block == true
        // nada de niños ni en la categoría ni en el género: fuera sin mirar el nombre
        if (!kidsCat && !weakCat && !gKids && !gWeak) return ""
        if (gBlock && !gKids && !gWeak) return ""
        val n = norm(x.name)
        if (c.m("block_marks", n) || c.m("block_titles", n)) return ""
        if ((kidsCat || gKids) && !gHard && !gBlock) return "strong"
        return "weak"
    }

    /* ---------- lo que se ve ---------- */

    /**
     * Lo permitido de un tipo: películas y series según su nivel y TMDB; en vivo solo las categorías de niños, sin canales
     * con marcas de adultos. Solo quedan las categorías con algo. Lo dudoso sin veredicto queda para [askPending].
     */
    fun filter(kind: Kind, cats: List<Category>, items: List<Item>): Pair<List<Category>, List<Item>> {
        val c = comp()
        val live = kind == Kind.LIVE
        val cls = HashMap<String, String>()
        cats.forEach { cls[it.id] = catClass(c, it.name, live) }
        val memo = HashMap<String, Genre>()
        val now = System.currentTimeMillis() / 1000
        val out = ArrayList<Item>()
        for (x in items) {
            val k = cls[x.categoryId] ?: ""
            if (live) {
                if (k == "kids" && !c.m("block_marks", norm(x.name))) out += x
                continue
            }
            val lvl = level(c, k, x, memo)
            if (lvl.isEmpty()) continue
            val key = q(x)
            val r = verdict(key)
            if ((lvl == "strong" && r != "no") || (lvl == "weak" && r == "ok")) out += x
            if (shouldAsk(key, now)) synchronized(pending) { pending[key] = ask(key, x) }
        }
        val used = out.mapTo(HashSet()) { it.categoryId }
        return cats.filter { it.id in used } to out
    }

    /** clave del título para api/kids_rate.php: su id de TMDB o, sin él, el nombre y el año (como la web) */
    private fun q(x: Item): String {
        val t = if (x.kind == Kind.SERIES) "s" else "m"
        if (x.tm.isNotEmpty() && x.tm != "0") return "$t:${x.tm}"
        val md = MessageDigest.getInstance("MD5").digest((norm(x.name) + "|" + x.year).toByteArray(Charsets.UTF_8))
        return t + "n:" + md.joinToString("") { b -> "%02x".format(b) }.take(16)
    }

    private fun ask(q: String, x: Item): JSONObject {
        val o = JSONObject().put("q", q).put("t", if (x.kind == Kind.SERIES) "s" else "m")
        return if (x.tm.isNotEmpty() && x.tm != "0") o.put("id", x.tm) else o.put("n", x.name).put("y", x.year)
    }

    /* ---------- veredictos de TMDB (api/kids_rate.php), por distribuidor ---------- */

    private val verdicts = HashMap<String, Pair<String, Long>>()
    private var loadedFor: String? = null
    private val pending = LinkedHashMap<String, JSONObject>()
    private val asked = HashMap<String, Long>()
    private var rounds = 0

    private fun rateFile(): File? = dir?.let { File(it, "kidsrate_" + Tenant.code.ifEmpty { "o" } + ".json") }

    private fun loadVerdicts() {
        val key = Tenant.code
        if (loadedFor == key) return
        loadedFor = key
        synchronized(verdicts) {
            verdicts.clear()
            runCatching {
                val f = rateFile() ?: return@runCatching
                if (!f.exists()) return@runCatching
                val o = JSONObject(f.readText(Charsets.UTF_8))
                o.keys().forEach { q -> o.optJSONArray(q)?.let { a -> verdicts[q] = a.optString(0) to a.optLong(1) } }
            }
        }
    }

    /** último veredicto para mostrar: "ok", "no", "?" o "" (sin respuesta todavía) */
    private fun verdict(q: String): String {
        loadVerdicts()
        val r = synchronized(verdicts) { verdicts[q]?.first }.orEmpty()
        return if (r == "wait") "" else r
    }

    /** sin veredicto, vencido (30 días ok / no, 7 días «?») o «wait»; nunca dos veces en 2 minutos */
    private fun shouldAsk(q: String, now: Long): Boolean {
        synchronized(asked) { asked[q]?.let { if (now - it < 120) return false } }
        val e = synchronized(verdicts) { verdicts[q] } ?: return true
        val ttl = when (e.first) { "?" -> 7 * 86400L; "wait" -> 0L; else -> 30 * 86400L }
        return now - e.second >= ttl
    }

    /** el perfil cambió (u otra línea): se empieza de nuevo con lo pendiente */
    fun resetPending() {
        synchronized(pending) { pending.clear() }
        synchronized(asked) { asked.clear() }
        rounds = 0
    }

    /**
     * Pregunta al panel lo dudoso, de a 400. Devuelve true si queda algo por preguntar (el que llama vuelve a llamar en
     * unos segundos). Con veredictos nuevos sube [rev].
     */
    suspend fun askPending(): Boolean = withContext(Dispatchers.IO) {
        if (rounds >= 40) return@withContext false
        val now = System.currentTimeMillis() / 1000
        // copia de lo pendiente (sin tener dos candados a la vez)
        val all = synchronized(pending) { pending.entries.map { it.key to it.value } }
        val batch = all.filter { shouldAsk(it.first, now) }.take(400).map { it.second }
        if (batch.isEmpty()) return@withContext false
        rounds++
        synchronized(asked) { batch.forEach { asked[it.optString("q")] = now } }
        val items = JSONArray().also { a -> batch.forEach { a.put(it) } }
        val r = Cloud.call { t -> Net.postJson(PanelUrl.api("kids_rate.php"), JSONObject().put("token", t).put("items", items)) }
        val j = r?.json()
        val map = j?.takeIf { it.optBoolean("success", false) }?.optJSONObject("r") ?: return@withContext true
        var changed = false
        val done = ArrayList<String>()
        synchronized(verdicts) {
            map.keys().forEach { q ->
                val v = map.optString(q)
                if (v == "ok" || v == "no" || v == "?" || v == "wait") {
                    if (v != "wait" && verdicts[q]?.first != v) changed = true
                    verdicts[q] = v to now
                    if (v != "wait") done += q
                }
            }
        }
        synchronized(pending) { done.forEach { pending.remove(it) } }
        saveVerdicts()
        if (changed) withContext(Dispatchers.Main) { rev++ }
        synchronized(pending) { pending.isNotEmpty() }
    }

    private fun saveVerdicts() {
        val now = System.currentTimeMillis() / 1000
        val o = JSONObject()
        synchronized(verdicts) {
            verdicts.forEach { (q, e) -> if (e.first != "wait" && now - e.second < 60 * 86400L) o.put(q, JSONArray().put(e.first).put(e.second)) }
        }
        runCatching { rateFile()?.writeText(o.toString(), Charsets.UTF_8) }
    }
}
