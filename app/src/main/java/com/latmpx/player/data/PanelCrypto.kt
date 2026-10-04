package com.latmpx.player.data

import android.util.Base64
import com.latmpx.player.BuildConfig
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Cifrados que usa el panel: AES-256-GCM con HKDF (login.php) y "mope" (auth.php). */
object PanelCrypto {
    class MissingKey : Exception("Falta la llave del panel (PANEL_MASTER_KEY). Pide al administrador una versión de la app configurada.")

    private const val SALT_LEN = 16
    private const val IV_LEN = 12
    private const val TAG_LEN = 16
    private val rnd = SecureRandom()

    /** Llave maestra (32 bytes) desde BuildConfig; null si no se configuró al compilar. */
    private fun masterKey(): ByteArray? {
        val hex = BuildConfig.PANEL_MASTER_KEY.trim()
        if (hex.length != 64 || !hex.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) return null
        return ByteArray(32) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    }

    fun hasKey(): Boolean = masterKey() != null

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray {
        val m = Mac.getInstance("HmacSHA256")
        m.init(SecretKeySpec(key, "HmacSHA256"))
        return m.doFinal(data)
    }

    /** Igual que hkdf() de login.php: prk = HMAC(salt, ikm); okm = HMAC(prk, 0x01)[0..32] */
    private fun hkdf(ikm: ByteArray, salt: ByteArray): ByteArray = hmac(hmac(salt, ikm), byteArrayOf(1)).copyOf(32)

    /** base64(salt16 + iv12 + cifrado + tag16) */
    fun encrypt(plain: String): String {
        val mk = masterKey() ?: throw MissingKey()
        val salt = ByteArray(SALT_LEN).also(rnd::nextBytes)
        val iv = ByteArray(IV_LEN).also(rnd::nextBytes)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(hkdf(mk, salt), "AES"), GCMParameterSpec(TAG_LEN * 8, iv))
        val ct = c.doFinal(plain.toByteArray(Charsets.UTF_8)) // Java ya agrega el tag al final
        return Base64.encodeToString(salt + iv + ct, Base64.NO_WRAP)
    }

    fun decrypt(b64: String): String? {
        val mk = masterKey() ?: throw MissingKey()
        return try {
            val bin = Base64.decode(b64.trim(), Base64.DEFAULT)
            if (bin.size < SALT_LEN + IV_LEN + TAG_LEN) return null
            val salt = bin.copyOfRange(0, SALT_LEN)
            val iv = bin.copyOfRange(SALT_LEN, SALT_LEN + IV_LEN)
            val ct = bin.copyOfRange(SALT_LEN + IV_LEN, bin.size)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, SecretKeySpec(hkdf(mk, salt), "AES"), GCMParameterSpec(TAG_LEN * 8, iv))
            String(c.doFinal(ct), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }

    /* ---------- mope (auth.php) ---------- */
    private const val MOPE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"

    /** Port de mope_encrypt(): base64 con basura insertada y dos letras al final que dicen dónde. */
    fun mopeEncrypt(json: String): String {
        val b = Base64.encodeToString(json.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        val at = rnd.nextInt(minOf(40, b.length - 1).coerceAtLeast(0) + 1)
        val n = 10 + rnd.nextInt(21)
        val junk = buildString { repeat(n) { append(MOPE[rnd.nextInt(62)]) } }
        val cut = (at + 2).coerceAtMost(b.length)
        return b.substring(0, cut) + junk + b.substring(cut) + MOPE[at + 17] + MOPE[n]
    }

    /** Port exacto de mope_decrypt(). */
    fun mopeDecrypt(input: String): String? {
        if (input.length < 2) return null
        val p1 = MOPE.indexOf(input[input.length - 2]) - 15
        val p2 = MOPE.indexOf(input[input.length - 1])
        if (p1 < 0 || p2 < 0) return null
        val core = input.substring(0, input.length - 2)
        val clean = core.take(p1) + core.drop(p1 + p2)
        return try {
            String(Base64.decode(clean, Base64.DEFAULT), Charsets.UTF_8).trim()
        } catch (e: Exception) {
            null
        }
    }
}
