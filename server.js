// ============================================
// SERVIDOR - Envío de SMS con Twilio
// ============================================

const express = require("express");
const cors = require("cors");
const path = require("path");

// ============================================
// CONFIGURACIÓN TWILIO
// Reemplaza estos valores con tus credenciales de Twilio
// ============================================
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "TU_ACCOUNT_SID_AQUI";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "TU_AUTH_TOKEN_AQUI";
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "+1XXXXXXXXXX"; // Número de Twilio

// ============================================
// SERVIDOR EXPRESS
// ============================================
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Servir archivos estáticos (HTML, JS, CSS, imágenes)
app.use(express.static(__dirname));

// Alias de compatibilidad: permite usar también /bcbia/... en este servidor
// (que sirve la carpeta bcbia en la raíz). Evita errores "Cannot GET /bcbia/..."
app.use("/bcbia", express.static(__dirname));

// ============================================
// RUTA: Enviar SMS
// ============================================
app.post("/api/send-sms", async (req, res) => {
  try {
    const { to, body } = req.body;

    // Validaciones
    if (!to || !body) {
      return res.status(400).json({
        success: false,
        message: "Se requieren los campos 'to' y 'body'",
      });
    }

    if (body.length > 1600) {
      return res.status(400).json({
        success: false,
        message: "El mensaje no puede exceder 1600 caracteres",
      });
    }

    // Validar formato de número
    const phoneRegex = /^\+[1-9]\d{6,14}$/;
    if (!phoneRegex.test(to)) {
      return res.status(400).json({
        success: false,
        message: "Número de teléfono inválido. Formato: +CódigoPaísNúmero (ej: +573001234567)",
      });
    }

    // Verificar que Twilio esté configurado
    if (TWILIO_ACCOUNT_SID === "TU_ACCOUNT_SID_AQUI") {
      return res.status(500).json({
        success: false,
        message: "Twilio no está configurado. Reemplaza las credenciales en server.js o configura las variables de entorno.",
      });
    }

    // ============================================
    // ENVIAR SMS CON TWILIO
    // ============================================
    const twilio = require("twilio")(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    const message = await twilio.messages.create({
      body: body,
      from: TWILIO_PHONE_NUMBER,
      to: to,
    });

    console.log(`[SMS] ✅ Enviado a ${to} | SID: ${message.sid}`);

    return res.json({
      success: true,
      message: `SMS enviado correctamente a ${to}`,
      sid: message.sid,
      status: message.status,
    });
  } catch (error) {
    console.error(`[SMS] ❌ Error: ${error.message}`);

    // Errores específicos de Twilio
    if (error.code === 21211) {
      return res.status(400).json({
        success: false,
        message: "Número de teléfono inválido o no existe",
      });
    }

    if (error.code === 21614) {
      return res.status(400).json({
        success: false,
        message: "El número no puede recibir SMS (posible número de teléfono fijo)",
      });
    }

    if (error.code === 21408) {
      return res.status(400).json({
        success: false,
        message: "Permiso no habilitado para enviar SMS a este destino. Verifica tu cuenta de Twilio.",
      });
    }

    if (error.code === 20003) {
      return res.status(401).json({
        success: false,
        message: "Credenciales de Twilio inválidas. Verifica TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN.",
      });
    }

    return res.status(500).json({
      success: false,
      message: `Error al enviar SMS: ${error.message}`,
    });
  }
});

// ============================================
// RUTA: Estado del servidor
// ============================================
app.get("/api/status", (req, res) => {
  const configured = TWILIO_ACCOUNT_SID !== "TU_ACCOUNT_SID_AQUI";
  res.json({
    server: "SMS Gateway",
    version: "1.0.0",
    twilioConfigured: configured,
    twilioFrom: configured ? TWILIO_PHONE_NUMBER : "No configurado",
  });
});

// ============================================
// RUTA: Página de login
// ============================================
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

// ============================================
// RUTA: Página SMS (catch-all para sms.html)
// ============================================
app.get("/sms", (req, res) => {
  res.sendFile(path.join(__dirname, "sms.html"));
});

// ============================================
// INICIAR SERVIDOR
// ============================================
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});

  if (TWILIO_ACCOUNT_SID === "TU_ACCOUNT_SID_AQUI") {
    console.log("⚠️  Twilio NO está configurado.");
    console.log("   Opción 1: Edita server.js con tus credenciales");
    console.log("   Opción 2: Crea variables de entorno:");
    console.log("     TWILIO_ACCOUNT_SID=ACxxxxx");
    console.log("     TWILIO_AUTH_TOKEN=xxxxx");
    console.log("     TWILIO_PHONE_NUMBER=+1xxxxx\n");
  } else {
    console.log(`✅ Twilio configurado | Desde: ${TWILIO_PHONE_NUMBER}\n`);
  }
});
