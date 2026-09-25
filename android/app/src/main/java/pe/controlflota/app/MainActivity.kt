package pe.controlflota.app

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
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
 * La app es la web de Control Flota a pantalla completa: mismas pantallas, mismo login y mismos
 * datos que en la PC. Lo nativo es lo que el navegador no resuelve solo: recordar el servidor,
 * elegir fotos, descargar PDFs, el botón atrás y la pantalla de "sin conexión".
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var recargar: SwipeRefreshLayout
    private lateinit var progreso: ProgressBar
    private lateinit var error: View
    private lateinit var servidor: String
    private var alElegirArchivo: ValueCallback<Array<Uri>>? = null
    private var ultimoAtras = 0L

    private val elegirArchivo = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        alElegirArchivo?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        alElegirArchivo = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val guardado = Servidor.leer(this)
        if (guardado == null) {
            startActivity(Intent(this, ServidorActivity::class.java))
            finish()
            return
        }
        servidor = guardado
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
            // La web usa esto para mostrar opciones propias de la app (p. ej. cambiar servidor).
            userAgentString = "$userAgentString ControlFlotaAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val url = req.url
                if (url.scheme == "flota-app") {
                    if (url.host == "servidor") abrirConfiguracion()
                    return true
                }
                // Lo del propio servidor se queda en la app; lo de fuera (Telegram, nodejs.org…) va al navegador.
                if (url.host == Uri.parse(servidor).host) return false
                abrirFuera(url)
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                recargar.isRefreshing = false
                CookieManager.getInstance().flush()
            }

            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (req.isForMainFrame) mostrarError(req.url.toString())
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
            error.visibility = View.GONE
            web.reload()
        }
        findViewById<Button>(R.id.cambiar).setOnClickListener { abrirConfiguracion() }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    error.visibility == View.VISIBLE -> { error.visibility = View.GONE; if (web.canGoBack()) web.goBack() }
                    web.canGoBack() -> web.goBack()
                    System.currentTimeMillis() - ultimoAtras < 2000 -> finish()
                    else -> {
                        ultimoAtras = System.currentTimeMillis()
                        Toast.makeText(this@MainActivity, R.string.salir_otra_vez, Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl("$servidor/?origen=android")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    private fun mostrarError(url: String) {
        recargar.isRefreshing = false
        findViewById<TextView>(R.id.error_texto).text = getString(R.string.error_texto, Uri.parse(url).let { "${it.scheme}://${it.authority}" })
        error.visibility = View.VISIBLE
    }

    private fun abrirConfiguracion() {
        startActivity(Intent(this, ServidorActivity::class.java))
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
