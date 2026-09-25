package pe.controlflota.app

import android.content.Context
import android.os.Build
import android.system.Os
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * **Control Flota corre dentro del celular**: la misma app que en la PC (Node.js + su base de
 * datos), sin servidor. Los datos viven en este dispositivo y se comparten con los demás desde la
 * pantalla Sincronizar, por el Wi-Fi.
 *
 * El programa va en los assets del APK (`assets/app`); en el primer arranque de cada versión se
 * copia a la memoria interna y Node lo ejecuta en un hilo propio. La WebView lo abre en
 * `http://127.0.0.1:3939`.
 */
object Nodo {
    const val PUERTO = 3939
    const val URL_LOCAL = "http://127.0.0.1:$PUERTO"
    private const val TAG = "ControlFlota"

    @Volatile var error: String? = null
        private set
    @Volatile var errorAnterior: String? = null
        private set
    @Volatile private var arrancado = false

    @JvmStatic private external fun arrancar(argumentos: Array<String>): Int

    /** Arranca Node una sola vez por proceso (Node no puede reiniciarse dentro del mismo proceso). */
    @Synchronized
    fun iniciar(ctx: Context) {
        if (arrancado) return
        arrancado = true
        val app = ctx.applicationContext
        Thread({
            try {
                val dir = prepararPrograma(app)
                val datos = File(app.filesDir, "datos").apply { mkdirs() }
                // Lo deja iniciar.mjs si el arranque anterior falló: se muestra si vuelve a fallar.
                val fallo = File(datos, "error-al-arrancar.txt")
                if (fallo.exists()) {
                    errorAnterior = fallo.readText().take(600)
                    fallo.delete()
                }
                Os.setenv("CF_DATOS", datos.absolutePath, true)
                Os.setenv("CF_PUERTO", PUERTO.toString(), true)
                Os.setenv("CF_NOMBRE_DISPOSITIVO", nombreDelEquipo(), true)
                Os.setenv("HOME", app.filesDir.absolutePath, true)
                Os.setenv("TMPDIR", app.cacheDir.absolutePath, true)
                Os.setenv("NODE_ENV", "production", true)
                System.loadLibrary("node")
                System.loadLibrary("puente")
                Log.i(TAG, "Arrancando Node en ${dir.absolutePath}")
                val codigo = arrancar(arrayOf("node", File(dir, "iniciar.mjs").absolutePath))
                error = "La app se detuvo (código $codigo). Ciérrala y ábrela otra vez."
                Log.e(TAG, "Node terminó con código $codigo")
            } catch (t: Throwable) {
                error = "No se pudo arrancar: ${t.message}"
                Log.e(TAG, "No se pudo arrancar Node", t)
            }
        }, "node").apply {
            isDaemon = true
            start()
        }
    }

    /** ¿Ya responde la app? Bloqueante: llamar fuera del hilo principal. */
    fun listo(): Boolean = try {
        val c = URL("$URL_LOCAL/salud").openConnection() as HttpURLConnection
        c.connectTimeout = 800
        c.readTimeout = 2000
        val ok = c.responseCode == 200
        c.disconnect()
        ok
    } catch (_: Exception) {
        false
    }

    private fun nombreDelEquipo(): String {
        val marca = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        val modelo = Build.MODEL
        return (if (modelo.startsWith(marca, true)) modelo else "$marca $modelo").take(40)
    }

    /** Copia `assets/app` a la memoria interna cuando cambió el APK (instalación o actualización). */
    private fun prepararPrograma(ctx: Context): File {
        val dir = File(ctx.filesDir, "app")
        val marca = File(dir, ".instalado")
        val info = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        val version = "${info.lastUpdateTime}"
        if (marca.exists() && marca.readText() == version) return dir
        Log.i(TAG, "Copiando el programa a ${dir.absolutePath}")
        dir.deleteRecursively()
        copiarAssets(ctx, "app", dir)
        marca.writeText(version)
        return dir
    }

    private fun copiarAssets(ctx: Context, ruta: String, destino: File) {
        val hijos = ctx.assets.list(ruta) ?: emptyArray()
        if (hijos.isEmpty()) {
            destino.parentFile?.mkdirs()
            ctx.assets.open(ruta).use { entrada -> destino.outputStream().use { entrada.copyTo(it, 64 * 1024) } }
            return
        }
        destino.mkdirs()
        for (h in hijos) copiarAssets(ctx, "$ruta/$h", File(destino, h))
    }
}
