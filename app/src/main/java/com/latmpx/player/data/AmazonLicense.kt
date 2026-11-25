package com.latmpx.player.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.amazon.device.drm.LicensingService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * Licencia de la Amazon Appstore (ramas «sin certificado», las que se suben a Amazon). Una copia sacada del equipo e
 * instalada por fuera de la Amazon Appstore no se puede usar: la app le pregunta a la tienda por su licencia (Appstore
 * SDK, llave pública en assets/AppstoreAuthenticationKey.pem), manda el resultado al panel (api/integrity.php, la misma
 * página Play Integrity del dueño) y, con el modo «Bloquear copias», muestra el aviso y no deja seguir.
 * Nunca se bloquea por un error: sin la tienda, sin respuesta, sin panel o con el modo apagado, sigue como siempre.
 * Un «con licencia» vale 24 h en el equipo.
 */
object AmazonLicense {
    /** el panel dijo que esta copia no es de la Amazon Appstore: la interfaz muestra el aviso y no deja seguir */
    var blocked by mutableStateOf(false)
        private set

    @Volatile private var running = false

    /** lo que contesta la Amazon Appstore (LICENSED, NOT_LICENSED, EXPIRED, ERROR_…); "TIMEOUT" sin respuesta en 20 s */
    private suspend fun askStore(ctx: Context): String = withTimeoutOrNull(20_000) {
        suspendCancellableCoroutine<String> { c ->
            try {
                LicensingService.verifyLicense(ctx.applicationContext) { r ->
                    if (c.isActive) c.resume(r?.requestStatus?.name ?: "UNKNOWN_ERROR")
                }
            } catch (e: Exception) {
                if (c.isActive) c.resume("UNKNOWN_ERROR")
            }
        }
    } ?: "TIMEOUT"

    /** después de entrar (con sesión): pregunta a la tienda y al panel, salvo un «con licencia» de menos de 24 h */
    suspend fun check(ctx: Context) {
        if (running || blocked || System.currentTimeMillis() < Store.integrityOkUntil) return
        running = true
        try {
            val status = askStore(ctx)
            val body = JSONObject().put("step", "amazon").put("package", ctx.packageName).put("device", Store.deviceIdOrEmpty()).put("status", status)
            val v = Cloud.call { t -> Net.postJson(PanelUrl.api("integrity.php"), JSONObject(body.toString()).put("token", t)) }?.json() ?: return
            // modo «Apagado» o un panel viejo: nada que hacer
            if (!v.optBoolean("active", false)) return
            if (v.optString("action") == "license") {
                withContext(Dispatchers.Main) { blocked = true }
                return
            }
            if (v.optString("verdict") == "ok") Store.integrityOkUntil = System.currentTimeMillis() + v.optLong("ttl", 86400).coerceIn(60, 7 * 86400) * 1000
        } catch (_: Exception) {
            // nunca se bloquea por un error
        } finally {
            running = false
        }
    }

    /** «Reintentar»: se olvida el bloqueo y se pregunta de nuevo (después de instalarla desde la Amazon Appstore) */
    suspend fun retry(ctx: Context) {
        withContext(Dispatchers.Main) { blocked = false }
        Store.integrityOkUntil = 0L
        check(ctx)
    }

    /** «Obtener en Amazon Appstore»: la ficha de la app en la tienda (o en la web de Amazon si no está la tienda) */
    fun openStore(ctx: Context) {
        val pkg = ctx.packageName
        runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("amzn://apps/android?p=$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .recoverCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.amazon.com/gp/mas/dl/android?p=$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
}
