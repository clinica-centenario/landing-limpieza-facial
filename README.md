# Landing · Limpieza facial profunda · Clínica Centenario

Landing de captación y reserva para la limpieza facial profunda personalizada con la Lic. Jaqueline Mansilla.
Flujo: **datos → guardado en Sheets → horarios reales → elección → confirmación en ambos calendarios → actualización de la misma fila → confirmación en pantalla.**

> **Estado:** no publicada. La página lleva `noindex` hasta que se indique publicar.

---

## 1. Estructura

```
public/                 ← lo que se sube al sitio (estático, sin build)
  index.html            contenido, SEO y datos estructurados
  styles.css            identidad tomada de clinicacentenario.com.uy/alquiler-consultorio
  app.js                formulario, agenda, confirmación, medición
  config.js             ★ configuración pública (sin secretos)
  photos.js             generado por tools/process_photos.py
  demo-api.js           API simulada, solo localhost + ?demo=1 (no subir a producción)
  img/                  logo, favicon e imagen principal (AVIF/WebP/JPG)
  media/                videos H.264 sin audio ni metadatos + portadas
backend/                ← proyecto de Google Apps Script (cuenta ccentenario3090@gmail.com)
  Config.gs             ★ parámetros operativos (sobrescribibles por Propiedades del script)
  Code.gs               endpoints: lead · availability · book · track
  Availability.gs       cruce profesional × consultorios, zona horaria
  Booking.gs            confirmación: lock, idempotencia, revalidación, rollback
  Sheets.gs             planilla: Contactos, Eventos, Configuración, Conciliación
  Security.gs           validación, anti-fórmulas, tokens, antispam
  Analysis.gs           análisis de piel con IA (orientación cosmética, no diagnóstico)
  Capi.gs               Meta Conversions API (opcional)
  Setup.gs              setupSecrets · setupSheet · checkCalendars · cleanupTestEvents
  appsscript.json       manifiesto (servicio avanzado Calendar v3 y permisos mínimos)
tests/
  backend.test.js       25 pruebas del backend real con Google simulado (node --test)
  analysis.test.js      8 pruebas del análisis con IA (filtros, menores, topes, privacidad)
  e2e_mobile.py         31 verificaciones del front en Chromium móvil
tools/process_photos.py revelado de RAW y exportación web
```

## 2. Qué quedó implementado, qué se probó y qué depende de configuración

| Parte | Implementado | Probado | Depende de |
|---|---|---|---|
| Landing mobile-first con identidad de la clínica | Sí | Chromium 390 px y 1366 px, sin scroll horizontal | Fotos |
| Formulario → Sheets antes de la agenda | Sí | Backend simulado + e2e | Desplegar Apps Script, `SHEET_ID` |
| Cruce Jaqueline × consultorio(s), 60 min completos | Sí | 5 pruebas (ocupados, recurrentes vía free/busy, "Disponible", márgenes, sin acceso) | ID del calendario de Jaqueline y consultorios habilitados |
| Zona horaria America/Montevideo | Sí | Navegador forzado en Madrid muestra horario de Montevideo | — |
| Confirmación con lock, revalidación, idempotencia y rollback | Sí | Dos personas mismo horario, doble clic, timeout + reintento, escritura externa durante la confirmación, fallo parcial, rollback imposible | Calendarios reales |
| Actualización de la misma fila en Sheets | Sí | Sí | Planilla real |
| Meta Pixel por etapas + CAPI opcional con `event_id` compartido | Sí | Orden y unicidad de PageView, formulario_abierto, Lead, vio_horarios, eligio_horario, Schedule; sin PII | `META_PIXEL_ID`; token CAPI si se usa |
| Reseñas | Componente listo, oculto | Oculto con lista vacía | Reseñas reales |
| Condiciones de pago y cancelación | Configurables, no publicadas | Ocultas mientras estén vacías | Definición comercial |

**No se probó contra Google real** (falta el calendario de Jaqueline y el despliegue). La primera prueba real se hace en `ENV=development`, donde todo lo creado lleva el prefijo `[TEST]`.

## 3. Cómo se calcula la disponibilidad

1. Se generan los inicios posibles: lunes a viernes, 9:00 a 21:00, último inicio 20:00, cada 30 min, respetando anticipación mínima, horizonte y fechas cerradas.
2. Se consulta **free/busy** de Jaqueline y de cada consultorio habilitado en una sola llamada. Free/busy expande eventos recurrentes, cuenta bloqueos y ausencias, **no cuenta eventos marcados "Disponible"** y no expone títulos ni pacientes.
3. Primero se filtra por Jaqueline libre los 60 min completos (más márgenes), después se exige al menos **un** consultorio libre en esa ventana.
4. Si un calendario no se puede leer, se considera **no disponible** (falla cerrada) y se registra `error_lectura_calendario` en la pestaña Eventos.

Al navegador solo llegan inicio y hora; nunca qué consultorio ni qué ocupa los huecos.

## 4. Confirmación y conflictos

Al confirmar, el servidor:

1. Verifica el token de la solicitud (nadie puede reservar con la solicitud de otro) y que el horario cumpla las reglas.
2. Toma el **lock del script**: las confirmaciones que entran por esta landing se procesan de a una.
3. Si la solicitud ya tiene reserva, devuelve esa misma reserva (una solicitud = una reserva).
4. **Revalida** free/busy de Jaqueline y consultorios para ese horario exacto.
5. Crea el evento de Jaqueline y después el del consultorio, ambos con el mismo **ID de reserva** en propiedades privadas. Los IDs de evento son **deterministas** a partir de la clave de idempotencia: un doble clic o un reintento choca contra el mismo ID en lugar de duplicar.
6. **Verifica después de escribir** que no haya aparecido otro evento ocupado en la ventana; si apareció, borra lo propio y ofrece alternativas.
7. Si falla el consultorio, borra el evento de Jaqueline. Si no se puede borrar, marca la fila **Pendiente de conciliación**, lo anota en la pestaña Conciliación y **no muestra éxito**.
8. Actualiza la misma fila. Si Sheets falla después de crear los eventos, la reserva es real y queda anotada en Conciliación (o en Propiedades del script si la planilla no responde).

### Limitaciones reales de concurrencia

- **Google Calendar no tiene transacciones ni bloqueos.** El lock protege solo las confirmaciones que pasan por este script.
- **Otras personas o sistemas que escriben en esos calendarios** (carga manual, el portal de profesionales en desarrollo, la propia Jaqueline desde su teléfono) no respetan ese lock. La revalidación previa y la verificación posterior reducen la ventana de conflicto a segundos, pero no la eliminan: si alguien carga un evento a mano justo después de la verificación posterior, puede quedar una superposición que el sistema no detecta. Para eliminarla del todo, el portal de profesionales debería reservar a través de este mismo script, o dedicar consultorios exclusivos a este servicio.
- **La agenda puede mostrar un horario recién ocupado** (caché de 45 s y tiempo que la persona tarda en elegir). Nunca se confirma sin revalidar; en ese caso aparece "se acaba de ocupar" con alternativas.
- **Eventos con prefijo "2 -" (cancelados dentro de las 24 h):** free/busy no lee títulos, así que esos eventos **siguen bloqueando** el consultorio. Es la opción conservadora; si querés liberarlos, hay que pasar a leer eventos completos (decisión pendiente).
- Cuotas de Apps Script (cuenta gratuita): de sobra para el volumen de una clínica.

## 5. Planilla

`setupSheet()` crea **"Clínica Centenario — Limpieza facial — Solicitudes"** con:

- **Contactos:** una fila por solicitud; columnas del brief, incluidas UTM, versión y fecha del consentimiento, estado de reserva y **estado de pago por separado** ("Sin pago registrado" hasta que alguien lo cambie a mano). Si la misma persona vuelve a enviar, se crea otra fila y la columna *Solicitudes previas* referencia las anteriores; nunca se sobrescribe.
- **Eventos:** datos_recibidos, vio_horarios, eligio_horario, horario_ocupado_al_confirmar, conflicto_detectado_post_escritura, reserva_confirmada, errores. Esto mide el embudo aunque el navegador bloquee el píxel.
- **Configuración:** parámetros no sensibles a modo de referencia (nunca tokens).
- **Conciliación:** casos que requieren revisión manual.

Todo valor que empiece con `=`, `+`, `-`, `@`, tabulación o retorno se guarda como texto.

## 6. Medición (Meta Pixel)

| Evento | Cuándo se dispara | Deduplicación |
|---|---|---|
| PageView | Al aceptar la medición (o al cargar, si ya se aceptó) | Una por carga |
| formulario_abierto | Primera interacción con un campo (no al tocar CTA) | Una por carga |
| Lead | Solo cuando el servidor confirmó el guardado | `eventID = lead_<solicitud>`; una por solicitud |
| vio_horarios | Cuando llegan horarios reales (≥1) | Una por solicitud |
| eligio_horario | Al elegir un horario | Una por horario |
| Schedule | Solo con reserva confirmada por el servidor en ambos calendarios | `eventID = schedule_<reserva>`; una por reserva, también tras recargar |

Ningún evento lleva nombre, celular, email ni datos de piel. El píxel se carga solo si la persona acepta medición (`TRACKING_CONSENT_MODE: 'banner'`). CAPI está apagado por defecto y, aun encendido, no envía email ni teléfono salvo `CAPI_SEND_HASHED_USER_DATA = true`.

## 7. Puesta en marcha (paso a paso)

Todo con la cuenta **ccentenario3090@gmail.com**. Nunca compartas contraseñas ni tokens por chat.

1. **Calendario de Jaqueline.** Que ella lo comparta con `ccentenario3090@gmail.com` con permiso **"Hacer cambios en los eventos"**. Su ID está en Google Calendar → Configuración del calendario → *Integrar el calendario* → *ID del calendario*.
2. **Consultorios habilitados.** Definir cuáles sirven para este tratamiento. IDs disponibles en la cuenta: Consultorio 1 `g1kstfglridfejoiqhup5mqovs@group.calendar.google.com` · Consultorio 2 `e3ujj47vavclddl9ugpra451rc@group.calendar.google.com` · Consultorio 5 `oeful3qgjf8se7rm4eprpmbffs@group.calendar.google.com` · Con 3 - Camilla 1 `qfh8nkq5vjkr8qmrormmfimfek@group.calendar.google.com` · Con 3 - Camilla 2 `0cfql63pn1kc97iqkjg14ij6g8@group.calendar.google.com` · Con 3 - Camilla 3 `80eatamkvlhl35sp45q0bpmv68@group.calendar.google.com` · Con 3 - Camilla 4 `2rh7bvmeuiatrjq9fju4gb39kk@group.calendar.google.com`.
3. **Proyecto de Apps Script.** script.google.com → Nuevo proyecto → crear un archivo por cada `.gs` de `backend/` y pegar su contenido. En Configuración del proyecto, activar *Mostrar el archivo de manifiesto* y reemplazar `appsscript.json`.
4. **Propiedades del script** (Configuración del proyecto → Propiedades del script):
   - `PRO_CALENDAR_ID` = ID de Jaqueline
   - `ROOM_CALENDAR_IDS` = IDs habilitados separados por coma, en orden de preferencia
   - `ROOM_LABELS` = sus nombres en el mismo orden (p. ej. `Consultorio 5,Con 3 - Camilla 1`)
   - `ENV` = `development` para probar
5. **Ejecutar desde el editor**, en orden: `setupSecrets` → `setupSheet` → `checkCalendars`. La primera vez Google pide autorizar los permisos del manifiesto. `checkCalendars` debe mostrar *free/busy: OK* y rol *writer* u *owner* en todos.
6. **Implementar** → Nueva implementación → Aplicación web → *Ejecutar como: Yo* · *Quién tiene acceso: Cualquier persona*. Copiar la URL que termina en `/exec` en `public/config.js` → `API_URL`.
7. **Probar en development:** hacer una reserva de punta a punta. Verificar los eventos `[TEST]` en ambos calendarios y la fila en Contactos. Limpiar con `cleanupTestEvents()`.
8. **Meta:** cargar `META_PIXEL_ID` en `config.js`. Para CAPI (opcional): `CAPI_ENABLED=true`, `META_PIXEL_ID` y el secreto `META_CAPI_TOKEN` en Propiedades del script. `CAPI_TEST_EVENT_CODE` sirve para validar en el Administrador de eventos.
9. **Antispam reforzado (opcional):** Cloudflare Turnstile → `TURNSTILE_SITE_KEY` en `config.js` y `TURNSTILE_SECRET` en Propiedades del script.
10. **Publicar (cuando se indique):** `ENV=production`, quitar la línea `noindex` de `index.html`, ajustar `CANONICAL_URL` y subir `public/` sin `demo-api.js`. Cada cambio de código del script requiere *Administrar implementaciones → Editar → Nueva versión* (la URL se mantiene).

## 7 bis. Análisis de piel con IA

La persona sube o saca una foto, marca que es mayor de 18 y que acepta el análisis, y recibe en texto: tipo de piel estimado (seca, grasa, mixta, normal o indeterminado) con nivel de confianza, lo que se observa en la foto, qué se podría trabajar en la sesión, consejos generales y, si corresponde, la recomendación de consultar a un médico. Termina con el botón para reservar.

**Resguardos implementados**

- **No diagnostica.** Las instrucciones al modelo prohíben nombrar condiciones médicas, y además el servidor descarta cualquier texto con términos diagnósticos o promesas (acné, rosácea, melasma, "curar", "eliminar manchas", "rejuvenecer", etc.). Si hay algo que amerita consulta médica, se recomienda consultar sin nombrar la condición.
- **Solo técnicas del protocolo.** Las sugerencias para la sesión salen de una lista cerrada (sin peeling químico) y se aclara que la profesional las define en la evaluación.
- **Foto:** se reduce a 1024 px y se re-codifica en el teléfono, lo que borra EXIF y GPS. Se envía al proveedor de IA solo para responder; **no se guarda** en Sheets, Drive, caché ni logs. En la planilla solo se registra que hubo un análisis, sin resultado ni datos de la persona.
- **Menores:** si la persona parece menor de 18, no se analiza.
- **Fotos no aptas** (oscuras, sin rostro, con filtros, varias personas): pide otra foto con indicaciones.
- **Costo y abuso:** topes globales por hora y por día y por dispositivo (`AI_MAX_PER_HOUR`, `AI_MAX_PER_DAY`, `AI_MAX_PER_CLIENT_DAY`), más Turnstile si está configurado.
- **Sin simulaciones en producción:** si la IA no está configurada, la sección lo informa; en la vista previa el resultado es un ejemplo fijo, marcado como tal.

**Para activarlo:** crear una clave en console.anthropic.com (cuenta de la clínica, con límite de gasto), cargarla como secreto `ANTHROPIC_API_KEY` en Propiedades del script y poner `AI_ENABLED=true`. El modelo se elige con `AI_MODEL` (por defecto `claude-sonnet-5-5`; `claude-haiku-5-5` es más económico). Para ocultar la sección: `AI_ANALYSIS_ENABLED: false` en `config.js`.

**A validar antes de publicar:** la foto del rostro es un dato personal sensible y se procesa con un proveedor en el exterior. El aviso de privacidad ya lo informa, pero conviene que un asesor confirme el texto y el registro ante la URCDP según la Ley 18.331.

## 8. Pendientes centralizados

| Dato | Dónde se carga | Mientras falte |
|---|---|---|
| ID del calendario de Jaqueline | Propiedad `PRO_CALENDAR_ID` | Se guardan los datos; la agenda informa que no está habilitada |
| Consultorios habilitados | Propiedad `ROOM_CALENDAR_IDS` (+ `ROOM_LABELS`) | Ídem |
| Autorización de Google | Paso 5 | El script no corre |
| ID de la planilla | Automático con `setupSheet()` (o propiedad `SHEET_ID`) | El formulario responde "no habilitado" |
| ID del píxel de Meta | `config.js` → `META_PIXEL_ID` | No se carga el píxel ni se pide consentimiento |
| Medio de pago y plazo del descuento | `config.js` → `PAYMENT` | Solo se explica que el descuento es por pago anticipado efectivo |
| Anticipación mínima | Propiedad `MIN_NOTICE_HOURS` | 0 (solo excluye horarios pasados) |
| Cancelación y reprogramación | `config.js` → `CANCELLATION_POLICY` | No se muestra; no hay autogestión de cambios |
| Canal para derechos de datos personales | `config.js` → `PRIVACY_CONTACT` | El aviso no nombra canal |
| URL definitiva | `config.js` → `CANONICAL_URL` y `index.html` | Se usa `/limpieza-facial` |
| Clave de IA para el análisis de piel | Secreto `ANTHROPIC_API_KEY` + `AI_ENABLED=true` | La sección informa que el análisis no está disponible |
| Feriados o cierres | Propiedad `CLOSED_DATES` | Se agenda cualquier día hábil libre en los calendarios |

## 9. Pruebas

```bash
node --test tests/backend.test.js tests/analysis.test.js   # backend (25 + 8)
pip install playwright && python3 -I tests/e2e_mobile.py public /tmp/capturas   # front móvil (31)
```

Revisión visual sin backend: servir `public/` en `localhost` y abrir `index.html?demo=1` (aviso permanente de MODO DEMO; `&conflict=1` simula que el horario se ocupó).
