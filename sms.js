(function () {
  // ============================================
  // CONFIGURACIÓN - URL del backend
  // ============================================
  const API_URL = window.location.origin; // Ajustar si el server corre en otro puerto

  // ============================================
  // ELEMENTOS DEL DOM
  // ============================================
  const form = document.getElementById("smsForm");
  const phonePrefix = document.getElementById("phonePrefix");
  const phoneNumber = document.getElementById("phoneNumber");
  const smsMessage = document.getElementById("smsMessage");
  const submitBtn = document.getElementById("submitBtn");
  const charCount = document.getElementById("charCount");
  const resultBox = document.getElementById("resultBox");

  // ============================================
  // VALIDACIÓN DEL FORMULARIO
  // ============================================
  function validateForm() {
    const prefix = phonePrefix.value.trim();
    const number = phoneNumber.value.trim();
    const message = smsMessage.value.trim();

    const isValid =
      prefix.length >= 2 &&
      number.length >= 6 &&
      message.length > 0;

    submitBtn.disabled = !isValid;
  }

  // ============================================
  // CONTADOR DE CARACTERES
  // ============================================
  function updateCharCount() {
    const len = smsMessage.value.length;
    const max = 1600;
    charCount.textContent = `${len} / ${max}`;
    charCount.classList.toggle("warning", len > max * 0.9);
  }

  // ============================================
  // MOSTRAR RESULTADO
  // ============================================
  function showResult(type, message) {
    resultBox.className = "result " + type;
    resultBox.querySelector(".result-icon").textContent =
      type === "success" ? "✅" : "❌";
    resultBox.querySelector(".result-text").textContent = message;
  }

  // ============================================
  // LIMPIAR RESULTADO
  // ============================================
  function clearResult() {
    resultBox.className = "result";
    resultBox.querySelector(".result-icon").textContent = "";
    resultBox.querySelector(".result-text").textContent = "";
  }

  // ============================================
  // ENVIAR SMS
  // ============================================
  async function sendSMS(e) {
    e.preventDefault();

    const prefix = phonePrefix.value.trim();
    const number = phoneNumber.value.trim();
    const message = smsMessage.value.trim();

    if (!prefix || !number || !message) return;

    // Construir número completo
    const fullNumber = prefix.startsWith("+")
      ? prefix + number
      : "+" + prefix + number;

    // UI: estado de carga
    submitBtn.classList.add("loading");
    submitBtn.disabled = true;
    clearResult();

    try {
      const response = await fetch(API_URL + "/api/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: fullNumber,
          body: message,
        }),
      });

      const data = await response.json();

      if (data.success) {
        showResult("success", data.message || `SMS enviado correctamente a ${fullNumber}`);
        // No limpiar automáticamente para que el usuario vea el resultado
        setTimeout(() => {
          clearResult();
        }, 8000);
      } else {
        showResult("error", data.message || "Error al enviar el SMS");
      }
    } catch (error) {
      console.error("Error de red:", error);
      showResult(
        "error",
        "Error de conexión. Verifica que el servidor esté activo."
      );
    } finally {
      submitBtn.classList.remove("loading");
      validateForm();
    }
  }

  // ============================================
  // EVENTOS
  // ============================================
  function init() {
    // Validación en tiempo real
    [phonePrefix, phoneNumber, smsMessage].forEach((el) => {
      el.addEventListener("input", validateForm);
      el.addEventListener("keyup", validateForm);
    });

    // Contador de caracteres
    smsMessage.addEventListener("input", updateCharCount);

    // Enviar formulario
    form.addEventListener("submit", sendSMS);

    // Validación inicial
    validateForm();
    updateCharCount();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();