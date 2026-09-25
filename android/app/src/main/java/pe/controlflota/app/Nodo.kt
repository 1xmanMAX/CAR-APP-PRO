package pe.controlflota.app

import android.app.ActivityManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.IBinder
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
 *
 * Node corre en su propio proceso (`:nodo`, ver [NodoServicio]): si se cae, la pantalla sigue
 * abierta, explica qué pasó y deja copiar el detalle.
 */
object Nodo {
    const val PUERTO = 3939
    const val URL_LOCAL = "http://127.0.0.1:$PUERTO"
    private const val TAG = "ControlFlota"

    const val PROCESO = ":nodo"
    private const val ARCHIVO_FALLO = "error-al-arrancar.txt"
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
                // Lo escribe iniciar.mjs si el arranque falla; se borra el de una vez anterior.
                File(datos, ARCHIVO_FALLO).delete()
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
                Log.e(TAG, "Node terminó con código $codigo")
            } catch (t: Throwable) {
                Log.e(TAG, "No se pudo arrancar Node", t)
                try { File(File(app.filesDir, "datos").apply { mkdirs() }, ARCHIVO_FALLO).writeText("No se pudo arrancar: $t") } catch (_: Exception) {}
            }
            // Node ya no corre: se cierra el proceso :nodo para que «Reintentar» arranque uno nuevo.
            android.os.Process.killProcess(android.os.Process.myPid())
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

    /** ¿Sigue vivo el proceso donde corre Node? */
    fun procesoVivo(ctx: Context): Boolean {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.runningAppProcesses?.any { it.processName == ctx.packageName + PROCESO } == true
    }

    /** Lo que se sabe de un fallo: el error que dejó Node y las últimas líneas del registro. */
    fun detalleDelFallo(ctx: Context): String {
        val partes = mutableListOf<String>()
        val fallo = File(File(ctx.filesDir, "datos"), ARCHIVO_FALLO)
        if (fallo.exists()) partes += fallo.readText().take(1500)
        try {
            // Una app puede leer su propio registro (incluye el del proceso :nodo).
            val p = Runtime.getRuntime().exec(arrayOf("logcat", "-d", "-t", "400", "-v", "brief"))
            val lineas = p.inputStream.bufferedReader().readLines()
                .filter { l -> listOf("ControlFlota", "AndroidRuntime", "libc", "DEBUG", "linker").any { l.contains(it) } }
                .takeLast(40)
            if (lineas.isNotEmpty()) partes += lineas.joinToString("\n")
        } catch (_: Exception) {}
        partes += "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · ${Build.MANUFACTURER} ${Build.MODEL} · ${Build.SUPPORTED_ABIS.joinToString()} · app ${BuildConfig.VERSION_NAME}"
        return partes.joinToString("\n\n")
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

/** Proceso aparte donde vive Node (y el permiso para oír los avisos de la red local). */
class NodoServicio : Service() {
    private var multicast: WifiManager.MulticastLock? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (multicast == null) {
            multicast = (applicationContext.getSystemService(WIFI_SERVICE) as WifiManager)
                .createMulticastLock("controlflota-sincro").apply { setReferenceCounted(false); acquire() }
        }
        Nodo.iniciar(this)
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        multicast?.release()
        super.onDestroy()
    }
}
