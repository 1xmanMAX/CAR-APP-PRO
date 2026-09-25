package pe.controlflota.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

/** Pantalla para elegir el servidor (la PC con INICIAR.bat o un dominio). */
class ServidorActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_servidor)
        aplicarBordes(findViewById(R.id.raiz))

        val campo = findViewById<EditText>(R.id.direccion)
        val estado = findViewById<TextView>(R.id.estado)
        val probar = findViewById<Button>(R.id.probar)
        val sinProbar = findViewById<Button>(R.id.sin_probar)
        Servidor.leer(this)?.let { campo.setText(it) }

        fun entrar(url: String) {
            Servidor.guardar(this, url)
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
        }

        probar.setOnClickListener {
            val url = Servidor.normalizar(campo.text.toString())
            if (url == null) {
                estado.text = getString(R.string.servidor_vacia)
                return@setOnClickListener
            }
            estado.setTextColor(ContextCompat.getColor(this, R.color.suave))
            estado.text = getString(R.string.servidor_probando)
            probar.isEnabled = false
            thread {
                val ok = Servidor.probar(url)
                runOnUiThread {
                    probar.isEnabled = true
                    if (ok) {
                        estado.text = getString(R.string.servidor_ok)
                        entrar(url)
                    } else {
                        estado.setTextColor(ContextCompat.getColor(this, R.color.acento))
                        estado.text = getString(R.string.servidor_falla, url)
                    }
                }
            }
        }
        sinProbar.setOnClickListener {
            val url = Servidor.normalizar(campo.text.toString())
            if (url == null) estado.text = getString(R.string.servidor_vacia) else entrar(url)
        }
        estado.visibility = View.VISIBLE
    }
}
