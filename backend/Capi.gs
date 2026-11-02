/**
 * Meta Conversions API (opcional). Se activa solo con:
 *   CAPI_ENABLED = true, META_PIXEL_ID, y el secreto META_CAPI_TOKEN en Propiedades del script.
 * Comparte event_id con el píxel del navegador para deduplicar (lead_<solicitud>, schedule_<reserva>).
 * Por defecto NO envía email ni teléfono (ni hasheados). Nunca envía datos de piel/salud.
 */
function sendCapi_(cfg, eventName, eventId, pageUrl, body, pii) {
  var token = getSecret_('META_CAPI_TOKEN');
  if (!cfg.CAPI_ENABLED || !cfg.META_PIXEL_ID || !token) return;
  try {
    var userData = {
      client_user_agent: cleanText_(body.userAgent, 400) || undefined,
      fbp: cleanText_(body.fbp, 100) || undefined,
      fbc: cleanText_(body.fbc, 200) || undefined
    };
    if (cfg.CAPI_SEND_HASHED_USER_DATA && pii) {
      userData.em = [sha256Hex_(pii.email)];
      userData.ph = [sha256Hex_(pii.phone.replace(/\D/g, ''))];
    }
    var payload = {
      data: [{
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: pageUrl || undefined,
        user_data: userData
      }]
    };
    if (cfg.CAPI_TEST_EVENT_CODE) payload.test_event_code = cfg.CAPI_TEST_EVENT_CODE;
    UrlFetchApp.fetch('https://graph.facebook.com/v21.0/' + encodeURIComponent(cfg.META_PIXEL_ID) + '/events?access_token=' + encodeURIComponent(token), {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
    });
  } catch (e) {
    console.warn('CAPI ' + eventName + ' falló');
  }
}
