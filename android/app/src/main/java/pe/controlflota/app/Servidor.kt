package pe.controlflota.app

import android.content.Context
import java.net.HttpURLConnection
import java.net.URL

/** Dónde vive la dirección del servidor de Control Flota y cómo se valida. */
object Servidor {
    private const val PREFS = "control_flota"
    private const val CLAVE = "servidor"

    fun leer(ctx: Context): String? =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(CLAVE, null)

    fun guardar(ctx: Context, url: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(CLAVE, url).apply()
    }

    /**
     * "192.168.1.10:3000" → "http://192.168.1.10:3000". Sin esquema se asume http para IPs y
     * nombres locales, y https para dominios de internet. Se quita la barra final.
     */
    fun normalizar(texto: String): String? {
        var t = texto.trim().trimEnd('/')
        if (t.isEmpty()) return null
        if (!t.startsWith("http://", true) && !t.startsWith("https://", true)) {
            val host = t.substringBefore('/').substringBefore(':')
            val local = host == "localhost" || host.endsWith(".local") || Regex("^\\d{1,3}(\\.\\d{1,3}){3}$").matches(host)
            t = (if (local) "http://" else "https://") + t
        }
        return try {
            val u = URL(t)
            if (u.host.isNullOrEmpty()) null else t
        } catch (_: Exception) {
            null
        }
    }

    /** Pide /salud al servidor. Bloqueante: llamar fuera del hilo principal. */
    fun probar(url: String): Boolean = try {
        val c = URL("$url/salud").openConnection() as HttpURLConnection
        c.connectTimeout = 5000
        c.readTimeout = 5000
        c.instanceFollowRedirects = true
        val ok = c.responseCode == 200 && c.inputStream.bufferedReader().use { it.readText() }.contains("\"ok\":true")
        c.disconnect()
        ok
    } catch (_: Exception) {
        false
    }
}
