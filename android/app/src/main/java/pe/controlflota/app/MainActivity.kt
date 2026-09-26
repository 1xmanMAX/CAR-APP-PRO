package pe.controlflota.app

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/** Rellena el espacio de la barra de estado y de navegación (Android 15 dibuja de borde a borde). */
fun aplicarBordes(v: View) {
    ViewCompat.setOnApplyWindowInsetsListener(v) { vista, insets ->
        val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
        vista.setPadding(b.left, b.top, b.right, b.bottom)
        insets
    }
}

/**
 * La app es Control Flota completo corriendo en el celular (ver [Nodo]): mismas pantallas que en
 * la PC, con su propia copia de los datos y sin servidor. Lo nativo es lo que el navegador no
 * resuelve solo: elegir fotos, descargar PDFs, el botón atrás, la pantalla de arranque y dejar
 * pasar los avisos de la red local para que la sincronización encuentre a los demás dispositivos.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var recargar: SwipeRefreshLayout
    private lateinit var progreso: ProgressBar
    private lateinit var error: View
    private val servidor = Nodo.URL_LOCAL
    private val principal = Handler(Looper.getMainLooper())
    private var alElegirArchivo: ValueCallback<Array<Uri>>? = null
    private var ultimoAtras = 0L

    private val elegirArchivo = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        alElegirArchivo?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        alElegirArchivo = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        arrancarNodo()
        setContentView(R.layout.activity_main)
        aplicarBordes(findViewById(R.id.raiz))

        web = findViewById(R.id.web)
        recargar = findViewById(R.id.recargar)
        progreso = findViewById(R.id.progreso)
        error = findViewById(R.id.error)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = false
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            // La web usa esto para ajustar detalles propios de la app (sin botón de instalar, etc.).
            userAgentString = "$userAgentString ControlFlotaAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val url = req.url
                // Lo de la propia app se queda aquí; lo de fuera (Telegram, SUNAT…) va al navegador.
                if (url.host == Uri.parse(servidor).host) return false
                abrirFuera(url)
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                recargar.isRefreshing = false
                CookieManager.getInstance().flush()
            }

            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (req.isForMainFrame) esperarYAbrir(req.url.toString())
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, p: Int) {
                progreso.progress = p
                progreso.visibility = if (p in 1..99) View.VISIBLE else View.GONE
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                alElegirArchivo?.onReceiveValue(null)
                alElegirArchivo = callback
                return try {
                    elegirArchivo.launch(Intent.createChooser(params.createIntent(), "Elegir foto o archivo"))
                    true
                } catch (_: ActivityNotFoundException) {
                    alElegirArchivo = null
                    false
                }
            }
        }

        web.setDownloadListener { url, userAgent, contentDisposition, mime, _ ->
            descargar(url, userAgent, contentDisposition, mime)
        }

        // Deslizar hacia abajo recarga, salvo en el visor 3D (ahí el dedo gira el trailer).
        recargar.setColorSchemeResources(R.color.acento)
        recargar.setOnChildScrollUpCallback { _, _ -> web.scrollY > 0 || (web.url ?: "").contains("/trailer") }
        recargar.setOnRefreshListener { web.reload() }

        findViewById<Button>(R.id.reintentar).setOnClickListener {
            arrancarNodo()
            esperarYAbrir(web.url ?: "$servidor/")
        }
        findViewById<Button>(R.id.copiar).setOnClickListener {
            val texto = findViewById<TextView>(R.id.error_detalle).text
            (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Control Flota", texto))
            Toast.makeText(this, R.string.copiado, Toast.LENGTH_SHORT).show()
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    error.visibility == View.VISIBLE -> finish()
                    web.canGoBack() -> web.goBack()
                    System.currentTimeMillis() - ultimoAtras < 2000 -> finish()
                    else -> {
                        ultimoAtras = System.currentTimeMillis()
                        Toast.makeText(this@MainActivity, R.string.salir_otra_vez, Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        esperarYAbrir(if (savedInstanceState != null) web.url ?: "$servidor/" else "$servidor/")
    }

    override fun onDestroy() {
        principal.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun arrancarNodo() {
        startService(Intent(this, NodoServicio::class.java))
    }

    /** Muestra «Abriendo…» hasta que la app interna responde y entonces carga [url]. */
    private fun esperarYAbrir(url: String) {
        error.visibility = View.VISIBLE
        findViewById<View>(R.id.reintentar).visibility = View.GONE
        findViewById<View>(R.id.fallo).visibility = View.GONE
        findViewById<TextView>(R.id.error_titulo).text = getString(R.string.abriendo)
        findViewById<TextView>(R.id.error_texto).text = getString(R.string.abriendo_texto)
        val inicio = System.currentTimeMillis()
        Thread {
            var visto = false
            var sinProceso = 0
            var avisado = false
            // Mientras el proceso de Node siga vivo se espera (la primera vez, en un celular lento,
            // copiar el programa y crear la base puede tardar); solo se da por fallido si se cierra.
            while (!Nodo.listo() && System.currentTimeMillis() - inicio < 600_000) {
                // Antes de verlo vivo por primera vez se le dan 20 s: en celulares lentos tarda en crearse.
                if (Nodo.procesoVivo(this)) { visto = true; sinProceso = 0 } else sinProceso++
                if (sinProceso >= 8 && (visto || System.currentTimeMillis() - inicio > 20_000)) break
                if (!avisado && System.currentTimeMillis() - inicio > 45_000) {
                    avisado = true
                    principal.post { findViewById<TextView>(R.id.error_texto).text = getString(R.string.abriendo_lento) }
                }
                Thread.sleep(250)
            }
            val ok = Nodo.listo()
            val detalle = if (ok) "" else Nodo.detalleDelFallo(this)
            principal.post {
                if (isDestroyed) return@post
                if (ok) {
                    error.visibility = View.GONE
                    if (web.url != url) web.loadUrl(url) else web.reload()
                } else mostrarError(detalle)
            }
        }.start()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    private fun mostrarError(detalle: String) {
        recargar.isRefreshing = false
        findViewById<TextView>(R.id.error_titulo).text = getString(R.string.error_titulo)
        findViewById<TextView>(R.id.error_texto).text = getString(R.string.error_texto)
        findViewById<TextView>(R.id.error_detalle).text = detalle
        findViewById<View>(R.id.fallo).visibility = View.VISIBLE
        findViewById<View>(R.id.reintentar).visibility = View.VISIBLE
        error.visibility = View.VISIBLE
    }

    private fun abrirFuera(url: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, url.toString(), Toast.LENGTH_LONG).show()
        }
    }

    /** PDFs, XML y CDR se bajan a Descargas con la sesión del usuario (la cookie). */
    private fun descargar(url: String, userAgent: String, contentDisposition: String?, mime: String?) {
        val nombre = URLUtil.guessFileName(url, contentDisposition, mime)
        try {
            val pedido = DownloadManager.Request(Uri.parse(url))
                .setMimeType(mime)
                .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                .addRequestHeader("User-Agent", userAgent)
                .setTitle(nombre)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, nombre)
            (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(pedido)
            Toast.makeText(this, getString(R.string.descargando, nombre), Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
            abrirFuera(Uri.parse(url))
        }
    }
}
