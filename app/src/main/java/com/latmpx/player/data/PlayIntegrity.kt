package com.latmpx.player.data

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.google.android.gms.tasks.Task
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityException
import com.google.android.play.core.integrity.StandardIntegrityManager
import com.google.android.play.core.integrity.model.IntegrityDialogResponseCode
import com.google.android.play.core.integrity.model.IntegrityDialogTypeCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.security.MessageDigest
import kotlin.coroutines.resume

/**
 * Play Integrity (solo las apps de Google Play: ramas play-store y play-store-tv). Una copia sacada del equipo e
 * instalada por fuera de Google Play (o modificada y firmada de nuevo) no se puede usar: el panel le pregunta a Google
 * por el certificado de este equipo (api/integrity.php, página Play Integrity del dueño) y, con el modo «Bloquear
 * copias», la app muestra el aviso de Google «Obtén esta app en Google Play» y no deja seguir.
 * Nunca se bloquea por un error: sin panel, sin llave en el panel, sin Google o «sin evaluar», la app sigue como
 * siempre. Un resultado bueno vale 24 h en el equipo (no se pregunta en cada inicio).
 */
object PlayIntegrity {
    /** proyecto de Google Cloud vinculado en Play Console (Integridad de la app › API de Play Integrity) */
    private const val CLOUD_PROJECT = 638300955155L

    /** el panel dijo que esta copia no es de Google Play: la interfaz muestra el aviso y no deja seguir */
    var blocked by mutableStateOf(false)
        private set

    private var manager: StandardIntegrityManager? = null
    private var provider: StandardIntegrityManager.StandardIntegrityTokenProvider? = null
    private var lastToken: StandardIntegrityManager.StandardIntegrityToken? = null
    @Volatile private var running = false

    // el último error de Google al pedir el certificado (su código va al panel: sin Play Store, sin red con Google…)
    private var lastError: Exception? = null

    private suspend fun <T> Task<T>.await(): T? = suspendCancellableCoroutine { c ->
        addOnSuccessListener { if (c.isActive) c.resume(it) }
        addOnFailureListener { e ->
            lastError = e
            if (c.isActive) c.resume(null)
        }
    }

    private fun sha256(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun errCode(e: Exception?): String = when (e) {
        is StandardIntegrityException -> e.errorCode.toString()
        null -> "timeout"
        else -> e.javaClass.simpleName.take(30)
    }

    /** después de entrar (con sesión): pregunta al panel, salvo que ya haya un «con licencia» de menos de 24 h */
    suspend fun check(ctx: Context) {
        if (running || blocked || System.currentTimeMillis() < Store.integrityOkUntil) return
        running = true
        try {
            val pkg = ctx.packageName
            val device = Store.deviceIdOrEmpty()
            val api = PanelUrl.api("integrity.php")
            val n = Cloud.call { t -> Net.postJson(api, JSONObject().put("token", t).put("step", "nonce").put("package", pkg).put("device", device)) }?.json()
            // modo «Apagado», sin llave en el panel o un panel viejo: nada que hacer
            if (n == null || !n.optBoolean("active", false)) return
            val nonce = n.optString("nonce")
            if (nonce.isEmpty()) return
            val token = withTimeoutOrNull(25_000) { requestToken(ctx, sha256("$nonce|$pkg")) }
            val body = JSONObject().put("step", "verify").put("package", pkg).put("device", device).put("nonce", nonce)
            if (token != null) body.put("it", token.token()) else body.put("err", errCode(lastError))
            val v = Cloud.call { t -> Net.postJson(api, JSONObject(body.toString()).put("token", t)) }?.json() ?: return
            if (v.optString("action") == "license") {
                lastToken = token
                withContext(Dispatchers.Main) { blocked = true }
                return
            }
            // «con licencia»: 24 h sin preguntar; cualquier otra cosa (sin evaluar, error): se pregunta en el próximo inicio
            if (v.optString("verdict") == "ok") Store.integrityOkUntil = System.currentTimeMillis() + v.optLong("ttl", 86400).coerceIn(60, 7 * 86400) * 1000
        } catch (_: Exception) {
            // nunca se bloquea por un error
        } finally {
            running = false
        }
    }

    private suspend fun requestToken(ctx: Context, hash: String): StandardIntegrityManager.StandardIntegrityToken? {
        lastError = null
        val m = manager ?: IntegrityManagerFactory.createStandard(ctx.applicationContext).also { manager = it }
        val p = provider ?: m.prepareIntegrityToken(
            StandardIntegrityManager.PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(CLOUD_PROJECT).build(),
        ).await()?.also { provider = it } ?: return null
        val t = p.request(StandardIntegrityManager.StandardIntegrityTokenRequest.builder().setRequestHash(hash).build()).await()
        // el proveedor vence (Google pide prepararlo de nuevo): la próxima vez se arma otro
        if (t == null) provider = null
        return t
    }

    /**
     * «Obtener en Google Play»: el aviso de Google (instalarla o recuperarla desde Google Play); si Google no lo puede
     * mostrar, la ficha de la app en Google Play. Después de un aviso resuelto se pregunta otra vez.
     */
    suspend fun fix(activity: Activity) {
        val t = lastToken
        val code = if (t != null) runCatching { t.showDialog(activity, IntegrityDialogTypeCode.GET_LICENSED).await() }.getOrNull() else null
        if (code == IntegrityDialogResponseCode.DIALOG_SUCCESSFUL) {
            retry(activity)
            return
        }
        if (code == null || code == IntegrityDialogResponseCode.DIALOG_UNAVAILABLE || code == IntegrityDialogResponseCode.DIALOG_FAILED) openStore(activity)
    }

    /** «Reintentar»: se olvida el bloqueo y se pregunta de nuevo (por ejemplo después de instalarla desde Google Play) */
    suspend fun retry(ctx: Context) {
        withContext(Dispatchers.Main) { blocked = false }
        Store.integrityOkUntil = 0L
        check(ctx)
    }

    fun openStore(ctx: Context) {
        val pkg = ctx.packageName
        runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .recoverCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
}
