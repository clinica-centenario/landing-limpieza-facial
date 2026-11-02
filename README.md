# Landing · Limpieza facial profunda · Clínica Centenario

Landing de captación y reserva para la limpieza facial profunda personalizada con la Lic. Jaqueline Mansilla.
Flujo: **datos (nombre, apellido, celular, correo) → guardado en la planilla "Datos Landing" → 3 horarios recomendados → elección (o WhatsApp si ninguno sirve) → confirmación en el calendario del consultorio → actualización de la misma fila → confirmación en pantalla.**

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
backend/                ← Apps Script vinculado a la planilla "Datos Landing" (cuenta ccentenario3090@gmail.com)
  Config.gs             ★ parámetros operativos (sobrescribibles por Propiedades del script)
  Code.gs               endpoints: lead · availability · book · track
  Availability.gs       cruce profesional × consultorios, zona horaria
  Booking.gs            confirmación: lock, idempotencia, revalidación, rollback
  Sheets.gs             planilla: Contactos, Eventos, Configuración, Conciliación
  Security.gs           validación, anti-fórmulas, tokens, antispam
  Analysis.gs           análisis de piel con IA (orientación cosmética, no diagnóstico)
  Capi.gs               Meta Conversions API (opcional)
  Setup.gs              configurarTodo · setupSecrets · setupSheet · setupRoomCalendar · checkCalendars · cleanupTestEvents
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

1. **Franjas de atención:** se leen de la pestaña **Horarios** de "Datos Landing" (una fila por franja: día, desde, hasta, activo). Se puede repetir un día para tener dos franjas. Un turno puede empezar desde "Desde" y tiene que terminar a más tardar en "Hasta". Las fechas de la pestaña **Días cerrados** se saltean. Duración, intervalo entre inicios, anticipación mínima, horizonte y márgenes salen de la pestaña **Configuración**. Los cambios se ven en la landing en menos de un minuto.
2. Se consulta **free/busy** del consultorio **Con 3 - Camilla 1** (y de la profesional, solo si algún día se configura `PRO_CALENDAR_ID`). Free/busy expande eventos recurrentes, **no cuenta eventos marcados "Disponible"** y no expone títulos ni pacientes.
3. **Recomendación:** se ofrecen los **3 horarios libres más próximos**, sin superponerse entre sí, empezando por los de las **próximas 24 h** (marcados "Próximas 24 h"). Si no hay lugar en 24 h, se ofrecen igual los siguientes más cercanos. Si ninguno le sirve, la persona escribe por **WhatsApp** (número de la pestaña Configuración) con su número de solicitud.
4. Si la planilla o un calendario no se pueden leer, no se ofrecen horarios (falla cerrada) y se registra `error_lectura_calendario` en la pestaña Eventos.

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

## 5. Planilla "Datos Landing"

Está en el Drive de ccentenario3090@gmail.com. El script la completa con `setupSheet()` sin borrar lo que cargó el equipo.

- **Contactos:** una fila por solicitud: nombre, apellido, celular, correo, origen (Reserva / Análisis de piel), UTM, versión y fecha del consentimiento, estado de reserva y **estado de pago por separado** ("Sin pago registrado" hasta que alguien lo cambie a mano). Si la misma persona vuelve a enviar, se crea otra fila y *Solicitudes previas* referencia las anteriores.
- **Horarios:** días y franjas en que se puede reservar. La carga el equipo cuando la Lic. Mansilla avisa su disponibilidad.
- **Días cerrados:** feriados o licencias (AAAA-MM-DD o DD/MM/AAAA).
- **Configuración:** duración, intervalo, anticipación, horizonte, ventana y cantidad de recomendaciones, márgenes y WhatsApp. El script lee la columna *Clave*; no cambiarla.
- **Análisis de piel:** reservada para la etapa del análisis con IA (resultado, nunca la foto).
- **Eventos:** datos_recibidos, vio_horarios, eligio_horario, horario_ocupado_al_confirmar, conflicto_detectado_post_escritura, reserva_confirmada, errores.
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

Todo con la cuenta **ccentenario3090@gmail.com**. Nunca compartas contraseñas ni tokens por chat. **Este repositorio es público:** IDs de planilla y calendarios, secretos y `.clasp.json` van solo en Propiedades del script o fuera del repo.

1. **Script vinculado a la planilla.** Con clasp logueado en ccentenario3090: `clasp create-script --type sheets --parentId <ID de Datos Landing> --rootDir backend` y `clasp push`. (A mano: en la planilla, Extensiones → Apps Script, un archivo por cada `.gs` y el manifiesto `appsscript.json`.)
2. **Ejecutar `configurarTodo`** desde el editor. La primera vez Google pide autorizar los permisos. Guarda `LEAD_SECRET`, `SHEET_ID` y el ID del calendario **Con 3 - Camilla 1** en Propiedades del script, y `checkCalendars` debe mostrar *free/busy: OK* y rol *writer* u *owner*.
3. **Cargar en la planilla** las franjas reales en **Horarios** y el número en **Configuración → WhatsApp de contacto**.
4. **Implementar** → Nueva implementación → Aplicación web → *Ejecutar como: Yo* · *Quién tiene acceso: Cualquier persona*. Copiar la URL que termina en `/exec` en `public/config.js` → `API_URL`.
5. **Probar en development** (`ENV=development`): reserva de punta a punta. Verificar el evento `[TEST]` en el calendario del consultorio y la fila en Contactos. Limpiar con `cleanupTestEvents()`.
6. **Meta:** cargar `META_PIXEL_ID` en `config.js`. Para CAPI (opcional): `CAPI_ENABLED=true`, `META_PIXEL_ID` y el secreto `META_CAPI_TOKEN` en Propiedades del script.
7. **Antispam reforzado (opcional):** Cloudflare Turnstile → `TURNSTILE_SITE_KEY` en `config.js` y `TURNSTILE_SECRET` en Propiedades del script.
8. **Publicar (cuando se indique):** `ENV=production`, quitar la línea `noindex` de `index.html`, ajustar `CANONICAL_URL`. Cada cambio de código del script requiere *Administrar implementaciones → Editar → Nueva versión* (la URL se mantiene).

**Calendario de la profesional (opcional):** hoy no se usa; la disponibilidad la carga el equipo en Horarios. Si más adelante se quiere cruzar y escribir también en su calendario, cargar `PRO_CALENDAR_ID` en Propiedades del script.

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
| Franjas reales de atención | Planilla → Horarios | Quedan las de ejemplo (martes y jueves 9 a 13) |
| WhatsApp de contacto | Planilla → Configuración | No se muestra el botón de WhatsApp |
| Despliegue del script y `API_URL` | Paso 1 a 4 | El formulario responde "no habilitado" |
| ID del píxel de Meta | `config.js` → `META_PIXEL_ID` | No se carga el píxel ni se pide consentimiento |
| Medio de pago y plazo del descuento | `config.js` → `PAYMENT` | Solo se explica que el descuento es por pago anticipado efectivo |
| Cancelación y reprogramación | `config.js` → `CANCELLATION_POLICY` | No se muestra; no hay autogestión de cambios |
| Canal para derechos de datos personales | `config.js` → `PRIVACY_CONTACT` | El aviso no nombra canal |
| URL definitiva | `config.js` → `CANONICAL_URL` y `index.html` | Se usa `/limpieza-facial` |
| Análisis de piel con IA | Otra etapa: `ANTHROPIC_API_KEY`, `AI_ENABLED=true` y `AI_ANALYSIS_ENABLED` | La sección no se muestra |

## 9. Pruebas

```bash
node --test tests/backend.test.js tests/analysis.test.js   # backend (31 + 8)
pip install playwright && python3 -I tests/e2e_mobile.py public /tmp/capturas   # front móvil (35), usa Google Chrome o CHROME_PATH
```

Revisión visual sin backend: servir `public/` en `localhost` y abrir `index.html?demo=1` (aviso permanente de MODO DEMO; `&conflict=1` simula que el horario se ocupó, `&empty=1` sin horarios, `&wa=59899123456` muestra el botón de WhatsApp).
