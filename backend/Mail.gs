/**
 * Correo de confirmación de la reserva a la persona.
 * Sale desde la cuenta que ejecuta el script (ccentenario3090@gmail.com) con el nombre de la clínica.
 * Si falla, la reserva sigue siendo válida: se registra en Eventos y no se informa error en pantalla.
 */

var DAY_NAMES_LONG_ = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
var MONTH_NAMES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2026-11-03' → 'martes 3 de noviembre' */
function longDateEs_(ymd) {
  var p = parseYmd_(ymd);
  if (!p) return ymd;
  var dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return DAY_NAMES_LONG_[dow] + ' ' + p.d + ' de ' + MONTH_NAMES_[p.m - 1];
}

function formatUyu_(n) { return '$' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

function escapeHtml_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Link de WhatsApp para pagar la consulta, con el mensaje ya escrito. */
function payWhatsappUrl_(cfg, booking, name) {
  if (!cfg.WHATSAPP_NUMBER) return '';
  var msg = 'Hola, soy ' + name + '. Quiero pagar mi reserva ' + booking.bookingId + ' de limpieza facial del ' +
            longDateEs_(booking.date) + ' a las ' + booking.time + ' h.';
  return 'https://wa.me/' + cfg.WHATSAPP_NUMBER + '?text=' + encodeURIComponent(msg);
}

function sendConfirmationEmail_(cfg, contact, booking) {
  if (!cfg.CONFIRMATION_EMAIL_ENABLED) return false;
  var clean = function (v) { return String(v == null ? '' : v).replace(/^'/, ''); };
  var to = clean(contact['Email']);
  if (!validateEmail_(to)) return false;
  var first = clean(contact['Nombre']).replace(/^\[TEST\] /, '');
  var name = contactName_(contact);
  var when = longDateEs_(booking.date);
  var end = Utilities.formatDate(new Date(booking.endIso), cfg.TIMEZONE, 'HH:mm');
  var pay = payWhatsappUrl_(cfg, booking, name);
  var rows = [
    ['Fecha', when.charAt(0).toUpperCase() + when.slice(1)],
    ['Hora', booking.time + ' a ' + end + ' (hora de Montevideo)'],
    ['Profesional', cfg.PROFESSIONAL_NAME],
    ['Dirección', cfg.ADDRESS],
    ['N.º de reserva', booking.bookingId]
  ];
  var html = [
    '<div style="font-family:Arial,sans-serif;font-size:15px;color:#2c2f26;max-width:520px">',
    '<p>Hola, ' + escapeHtml_(first) + ':</p>',
    '<p>Tu reserva de <strong>' + escapeHtml_(cfg.SERVICE_NAME.toLowerCase()) + '</strong> en Clínica Centenario está confirmada.</p>',
    '<table style="border-collapse:collapse;margin:12px 0">',
    rows.map(function (r) {
      return '<tr><td style="padding:4px 14px 4px 0;color:#6f7266">' + escapeHtml_(r[0]) + '</td><td style="padding:4px 0"><strong>' + escapeHtml_(r[1]) + '</strong></td></tr>';
    }).join(''),
    '</table>',
    '<p><strong>Último paso: pagá tu consulta.</strong> Con pago anticipado el precio es ' + formatUyu_(cfg.PREPAID_PRICE_UYU) +
      ' (precio de lista ' + formatUyu_(cfg.LIST_PRICE_UYU) + ').' + (pay ? ' Escribinos por WhatsApp y te pasamos los datos:' : '') + '</p>',
    pay ? '<p><a href="' + escapeHtml_(pay) + '" style="display:inline-block;background:#566537;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px">Pagar por WhatsApp</a></p>' : '',
    '<p style="color:#6f7266;font-size:13px">Si necesitás cambiar o cancelar la reserva, respondé este correo o escribinos por WhatsApp.</p>',
    '<p>Clínica Centenario</p>',
    '</div>'
  ].join('');
  var text = 'Hola, ' + first + ':\n\nTu reserva está confirmada.\n' +
    rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n') +
    '\n\nÚltimo paso: pagá tu consulta. Con pago anticipado el precio es ' + formatUyu_(cfg.PREPAID_PRICE_UYU) + '.' +
    (pay ? '\nPagar por WhatsApp: ' + pay : '') + '\n\nClínica Centenario';
  try {
    MailApp.sendEmail({
      to: to,
      subject: (cfg.ENV === 'production' ? '' : '[TEST] ') + 'Reserva confirmada: limpieza facial, ' + when + ' ' + booking.time + ' h',
      body: text,
      htmlBody: html,
      name: 'Clínica Centenario'
    });
    logEvent_(cfg, clean(contact['ID solicitud']), 'correo_confirmacion_enviado', { bookingId: booking.bookingId });
    return true;
  } catch (e) {
    logEvent_(cfg, clean(contact['ID solicitud']), 'error_correo_confirmacion', { bookingId: booking.bookingId, msg: shortErr_(e) });
    return false;
  }
}
