/**
 * Configuración pública de la landing (sin secretos: todo lo de acá es visible en el navegador).
 * Lo marcado PENDIENTE no está definido. Mientras siga vacío, la landing NO publica esa información.
 */
window.CC_CONFIG = {
  // URL del Web App de Apps Script (termina en /exec). PENDIENTE hasta desplegar.
  API_URL: 'https://script.google.com/macros/s/AKfycbxlh5PM1CsiiJTqRtnHeavdbR4OVQD15jpBzJOXVcssrgz1IJikm6WcfZ3ZqFeMnPWLRA/exec',

  // Meta Pixel. PENDIENTE. Vacío = no se carga el píxel.
  META_PIXEL_ID: '',
  // 'banner' = el píxel se carga solo si la persona acepta medición (recomendado).
  // 'none'   = se carga sin pedir consentimiento (solo si la asesoría legal lo valida).
  TRACKING_CONSENT_MODE: 'banner',

  // Cloudflare Turnstile (opcional, antispam). Si se usa, cargar también TURNSTILE_SECRET en el script.
  TURNSTILE_SITE_KEY: '',

  // URL canónica final de la landing. PENDIENTE (ruta definitiva).
  CANONICAL_URL: 'https://clinicacentenario.com.uy/limpieza-facial',

  // WhatsApp de respaldo si la planilla no tiene uno cargado (con código de país, sin +). PENDIENTE.
  // El número que manda es el de la pestaña Configuración de "Datos Landing".
  WHATSAPP_NUMBER: '',

  CONSENT_VERSION: 'v1-2026-10',
  TIMEZONE: 'America/Montevideo',

  PRICES: { list: 2280, prepaid: 1824, discountPct: 20, saving: 456 },

  // Pago anticipado. PENDIENTE: medio de pago y plazo.
  // Mientras confirmed=false, la landing solo explica que el precio con descuento
  // corresponde al pago anticipado efectivo, sin publicar medio, plazo ni datos bancarios.
  PAYMENT: {
    confirmed: false,
    method: '',          // p.ej. "transferencia bancaria" — PENDIENTE
    deadline: '',        // p.ej. "hasta 24 horas antes de la sesión" — PENDIENTE
    instructionsAfterBooking: '' // texto a mostrar en la confirmación — PENDIENTE
  },

  // Reglas de cancelación y reprogramación. PENDIENTE. Vacío = no se muestran.
  CANCELLATION_POLICY: '',

  // Canal para ejercer derechos sobre datos personales (Ley 18.331). PENDIENTE.
  PRIVACY_CONTACT: '',

  // Análisis de piel con IA. Requiere AI_ENABLED y ANTHROPIC_API_KEY en el script.
  // false = la sección no se muestra. Pide los datos antes de la foto y guarda el resultado en la pestaña "Análisis de piel".
  AI_ANALYSIS_ENABLED: true,

  // Reseñas reales. Vacío = el bloque NO se muestra. Formato: { text, author, date }
  // No cargar reseñas inventadas, editadas sin permiso ni puntajes que no existan.
  REVIEWS: []
};
