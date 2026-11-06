"""
Prueba de la evaluación cosmética en un celular (390 px), en modo demo y sin tocar la API real.
Simula la cámara con un video generado desde UNA selfie de prueba (no se guardan fotos en el repo).

Casos: cámara guiada y revisión de la foto · preguntas obligatorias sin respuestas marcadas · informe con
secciones A-F · marcas: activar/desactivar, selección sincronizada con la tarjeta, alineadas al cambiar tamaño
y orientación · envío opcional con consentimiento aparte (y su falla) · permiso de cámara denegado ·
modelo de IA que no carga · foto oscura, sobreexpuesta, borrosa, sin rostro y con dos rostros · sin foto ·
respuestas que piden consulta médica.

Uso: python3 -I tests/e2e_orientacion.py public <carpeta de salida> <selfie.jpg>
Requiere: pip install playwright pillow, ffmpeg y Google Chrome instalados.
Para la validación con personas reales: probar con ?diagnostico=1 en teléfonos (distintos tonos de piel,
modelos y luces) y calibrar PHOTO_RULES (app.js) y SKIN_RULES (evaluation.js).
"""
import subprocess, tempfile, sys, re, os, threading, http.server, functools, time
from PIL import Image, ImageFilter, ImageEnhance
from playwright.sync_api import sync_playwright

PUBLIC, OUT, SELFIE = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
TMP = tempfile.mkdtemp()
face = Image.open(SELFIE).convert('RGB')
face = face.resize((560, int(face.height * 560 / face.width)), Image.LANCZOS)

def framed(im, w=720, h=960):
    c = Image.new('RGB', (w, h), (150, 120, 110)); c.paste(im, ((w - im.width) // 2, max(0, (h - im.height) // 2 - 60))); return c

framed(face.resize((760, int(face.height * 760 / face.width)), Image.LANCZOS)).save(os.path.join(TMP, 'f.png'))
Y4M = os.path.join(TMP, 'cam.y4m')
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-loop', '1', '-t', '6', '-i', os.path.join(TMP, 'f.png'),
                '-vf', 'fps=10,format=yuv420p', Y4M], check=True)
# Fotos para subir (casos de rechazo)
up = {}
def save(name, im): p = os.path.join(TMP, name + '.jpg'); im.save(p, quality=92); up[name] = p
big = framed(face, 900, 1200)
save('buena', big)
from PIL import ImageDraw
def marked():
    """Foto de prueba con evidencia localizada: un reflejo compacto en la frente, puntitos oscuros en la nariz y mejillas rojizas.
    Rostro grande para que haya detalle suficiente (más de 3 px por mm)."""
    f = face.resize((880, int(face.height * 880 / face.width)), Image.LANCZOS); W, H = f.size; d = ImageDraw.Draw(f, 'RGBA')
    for dx, dy in [(0, 0), (14, 6), (-12, 8), (4, 16), (-6, -10), (10, -8)]:
        x, y = W * .5 + dx, H * .2 + dy; d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=(255, 255, 255, 255))
    for dx, dy in [(0, 0), (7, 5), (-6, 6), (3, -7), (-5, -4), (8, -2)]:  # agrupados en un costado de la nariz
        x, y = W * .5 + 24 + dx, H * .47 + dy; d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(40, 25, 20, 255))
    for cx in (.28, .72): d.ellipse((W * (cx - .1), H * .5, W * (cx + .1), H * .68), fill=(230, 30, 30, 95))
    return framed(f, 900, 1200)
save('marcada', marked())
save('oscura', ImageEnhance.Brightness(big).enhance(0.12))
save('quemada', ImageEnhance.Brightness(big).enhance(3.2))
save('borrosa', big.filter(ImageFilter.GaussianBlur(9)))
save('sinrostro', Image.new('RGB', (900, 1200), (180, 170, 160)))
two = Image.new('RGB', (1400, 1000), (150, 120, 110)); small = face.resize((560, int(face.height)), Image.LANCZOS)
two.paste(small, (60, 150)); two.paste(small, (780, 150)); save('dos', two)

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=PUBLIC)); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://localhost:{srv.server_address[1]}/"
cfgjs = re.sub(r"API_URL: '[^']*'", "API_URL: ''", open(os.path.join(PUBLIC, "config.js")).read())
errors, fails = [], []

def check(cond, msg):
    print(('  ok  ' if cond else '  FALLA ') + msg)
    if not cond: fails.append(msg)

ANS = {  # pantalla → opciones a marcar (texto)
    'Sobre la foto': ['Nada, la cara lavada'],
    'Brillo': ['En frente, nariz y mentón', 'A pocas horas de lavarme la cara'],
    'Después de lavarte la cara': ['A veces', 'No'],
    'Productos': ['A veces'],
    'Tu rutina': ['Limpiador facial', 'Protector solar'],
    'Tu objetivo': ['Despejar puntitos oscuros o poros'],
    'Últimas semanas': ['Nada de esto'],
}

def answer_quiz(pg, safety='no', medical=False):
    for _ in range(12):
        if not pg.is_visible('#aiQ'): break
        step = pg.text_content('#aiQStep'); title = step.split('·')[-1].strip()
        if title == 'Para tu seguridad':
            for i, fs in enumerate(pg.query_selector_all('#aiQ fieldset')):
                k = fs.get_attribute('data-k')
                val = 'si' if medical and k in ('sangrado', 'cambio') else safety
                fs.query_selector(f'input[value="{val}"]').check()
        elif title == 'Sobre la foto':
            pg.click('#aiQ fieldset[data-k="en_cara"] .ai-opt:has-text("Nada, la cara lavada")')
            if pg.is_visible('#aiQ fieldset[data-k="filtro"]'): pg.click('#aiQ fieldset[data-k="filtro"] .ai-opt:has-text("No")')
        elif title == 'Brillo':
            pg.click('#aiQ .ai-opt:has-text("En frente, nariz y mentón")'); pg.wait_for_timeout(100)
            pg.click('#aiQ .ai-opt:has-text("A pocas horas de lavarme la cara")')
        elif title == 'Después de lavarte la cara':
            pg.click('#aiQ fieldset[data-k="tirantez"] .ai-opt:has-text("A veces")'); pg.click('#aiQ fieldset[data-k="descamacion"] .ai-opt:has-text("No")')
        else:
            for t in ANS.get(title, []): pg.click(f'#aiQ .ai-opt:has-text("{t}")')
        last = 'Ver mi resultado' in pg.inner_text('#aiQNext')
        pg.click('#aiQNext'); pg.wait_for_timeout(150)
        if last: break

def lead(pg):
    if pg.is_visible('#aiLead'):
        pg.fill("#a-firstName", "Bea"); pg.fill("#a-lastName", "Gómez"); pg.fill("#a-phone", "098111222"); pg.fill("#a-email", "bea@example.com"); pg.check("#a-consent")
        pg.wait_for_timeout(2600); pg.click("#aiLeadBtn")
    pg.wait_for_selector("#aiResult:not([hidden])", timeout=15000)

def badge_rel(pg):
    """Posición de cada número relativa a la foto (0..1): debe mantenerse al cambiar el tamaño."""
    return pg.evaluate("""() => { const s = document.querySelector('.ai-photo-svg'); if (!s) return null; const r = s.getBoundingClientRect();
      return [...s.querySelectorAll('.ai-badge circle')].map(c => { const b = c.getBoundingClientRect();
        return [+((b.x + b.width / 2 - r.x) / r.width).toFixed(3), +((b.y + b.height / 2 - r.y) / r.height).toFixed(3)]; }); }""")

def ring_drift(pg):
    """Distancia máxima (en píxeles de pantalla) entre cada anillo y el punto de la foto que marca."""
    return pg.evaluate("""() => { const s = document.querySelector('.ai-photo-svg'), im = s.querySelector('image'); const ir = im.getBoundingClientRect();
      const W = +im.getAttribute('width'), H = +im.getAttribute('height');
      return Math.max(0, ...[...s.querySelectorAll('.ai-ring')].map(c => { const b = c.getBoundingClientRect();
        const ex = ir.x + (+c.getAttribute('cx')) / W * ir.width, ey = ir.y + (+c.getAttribute('cy')) / H * ir.height;
        return Math.hypot(b.x + b.width / 2 - ex, b.y + b.height / 2 - ey); })); }""")

def visible_words(pg):
    """Palabras visibles del resultado inicial, sin desplegables cerrados, tarjeta ni alerta de revisión previa."""
    return pg.evaluate("""() => { const r = document.querySelector('#aiResult'); let t = r.innerText;
      r.querySelectorAll('.ai-review-box').forEach(e => { t = t.replace(e.innerText, ''); });
      return t.split(/\s+/).filter(w => /[\wáéíóúñ]/i.test(w)).length; }""")

def marks_checks(pg, n_badges, shot):
    pg.click('.ai-badge >> nth=0'); pg.wait_for_timeout(300)
    t = pg.inner_text('.ai-detail') if pg.is_visible('.ai-detail') else ''
    check(t.startswith('1') and '1 · ' in t and 'Zona:' in t, 'tocar el círculo 1 abre su tarjeta: ' + t.replace('\n', ' | ')[:160])
    check(pg.get_attribute('.ai-chip >> nth=0', 'aria-expanded') == 'true', 'la etiqueta de la marca queda seleccionada')
    pg.locator('.ai-photo').screenshot(path=OUT + shot)
    if n_badges > 1:
        n2 = pg.get_attribute('.ai-chip >> nth=1', 'data-n'); pg.click('.ai-chip >> nth=1'); pg.wait_for_timeout(200)
        check(pg.inner_text('.ai-detail').find(n2 + ' · ') >= 0 and pg.evaluate("document.querySelectorAll('.ai-detail').length") == 1, 'tocar otra etiqueta cambia la tarjeta (una sola abierta)')
        check('is-sel' in (pg.get_attribute(f'.ai-badge[data-n="{n2}"]', 'class') or ''), 'la etiqueta selecciona su círculo en la foto')
        pg.click('.ai-chip >> nth=1')
    else: pg.click('.ai-chip >> nth=0')
    check(not pg.is_visible('.ai-detail'), 'tocar la marca abierta la cierra')
    pg.focus('.ai-badge >> nth=0'); pg.keyboard.press('Enter'); pg.wait_for_timeout(150)
    check(pg.is_visible('.ai-detail'), 'funciona con teclado'); pg.keyboard.press('Enter')
    pg.click('.ai-toggle:has-text("Ocultar marcas")'); check(pg.evaluate("getComputedStyle(document.querySelector('.ai-photo-svg .ai-marks')).display") == 'none', 'se pueden ocultar las marcas')
    pg.click('.ai-toggle:has-text("Mostrar marcas")')
    d0 = ring_drift(pg); before = badge_rel(pg)
    pg.click('.ai-zoom-btn[aria-label="Ampliar la foto"]'); pg.wait_for_timeout(200)
    check(pg.evaluate("document.querySelector('.ai-photo-svg').classList.contains('is-zoomed')"), 'se puede ampliar la foto')
    d1 = ring_drift(pg)
    r = pg.evaluate("document.querySelector('.ai-photo-svg').getBoundingClientRect().toJSON()")
    pg.mouse.move(r['x'] + r['width'] * .5, r['y'] + r['height'] * .5); pg.mouse.down(); pg.mouse.move(r['x'] + r['width'] * .3, r['y'] + r['height'] * .4, steps=5); pg.mouse.up()
    d2 = ring_drift(pg)
    pg.locator('.ai-photo').screenshot(path=OUT + shot.replace('.png', '-ampliada.png'))
    for _ in range(4):
        if pg.is_enabled('.ai-zoom-btn[aria-label="Alejar la foto"]'): pg.click('.ai-zoom-btn[aria-label="Alejar la foto"]')
    check(not pg.evaluate("document.querySelector('.ai-photo-svg').classList.contains('is-zoomed')"), 'vuelve a la foto completa')
    check(max(d0, d1, d2) < 1.5, f'anillos alineados con la foto al ampliar y mover (desvío máx. {max(d0, d1, d2):.2f} px)')
    pg.set_viewport_size({"width": 844, "height": 390}); pg.wait_for_timeout(400); after = badge_rel(pg); d3 = ring_drift(pg)
    check(before == after and d3 < 1.5, f'marcas alineadas al girar la pantalla {before} → {after}')
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(300)

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", f"--use-file-for-fake-video-capture={Y4M}"])
    def page(perms=("camera",), url="?demo=1&wa=59899123456", block_model=False):
        ctx = b.new_context(viewport={"width": 390, "height": 844}, permissions=list(perms), device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = ctx.new_page()
        pg.route("**/config.js*", lambda r: r.fulfill(status=200, content_type="text/javascript", body=cfgjs))
        pg.route("https://script.google.com/**", lambda r: r.abort())
        if block_model: pg.route("https://cdn.jsdelivr.net/**", lambda r: r.abort())
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(BASE + url); pg.click("#aiHeroLink"); pg.wait_for_timeout(500); pg.check("#aiAdult")
        return pg

    print("1. Cámara guiada → revisión → preguntas → informe")
    pg = page(url="?demo=1&wa=59899123456&diagnostico=1")
    pg.click("#aiStart"); t0 = time.time(); msgs = []
    while time.time() - t0 < 45 and not pg.is_visible('[data-ai="revision"]'):
        m = pg.inner_text("#aiCamMsg")
        if not msgs or msgs[-1] != m: msgs.append(m)
        pg.wait_for_timeout(250)
    print("   mensajes de la cámara:", ' → '.join(msgs[:8]))
    check(pg.is_visible('[data-ai="revision"]'), 'captura automática y pantalla de revisión')
    pg.wait_for_selector('#aiReviewImg:not([hidden])', timeout=5000)
    print("   controles:", pg.eval_on_selector_all('#aiReviewChecks li', 'e=>e.map(x=>x.className+": "+x.textContent)'))
    print("   diag:", pg.inner_text('#aiDiag').replace('\n', '')[:700])
    check(pg.is_visible('#aiUse') and pg.is_visible('#aiRetry'), 'permite usar o repetir la foto')
    check('is-mirror' in (pg.get_attribute('#aiReviewImg', 'class') or ''), 'la vista previa de la cámara se ve en espejo, como la vio la persona')
    pg.locator('.ai-tool').screenshot(path=OUT + '/1-revision.png')
    pg.click('#aiUse')
    check(pg.text_content('#aiQStep').startswith('Paso 1 de 8'), 'con foto de cámara: 8 pasos (sin la pregunta del filtro) — ' + pg.text_content('#aiQStep'))
    check(pg.eval_on_selector_all('#aiQ input:checked', 'e=>e.length') == 0, 'ninguna respuesta viene marcada')
    pg.click('#aiQNext'); check('Falta' in pg.inner_text('#aiQStatus'), 'no avanza con preguntas sin responder: ' + pg.inner_text('#aiQStatus'))
    answer_quiz(pg)
    check(pg.is_visible('#aiLead'), 'pide los datos de contacto antes del resultado')
    lead(pg)
    txt = pg.inner_text('#aiResult')
    for h in ['Tu piel, de cerca', 'Qué podemos trabajar', 'Ver mis respuestas', 'Sobre este análisis']:
        check(h in txt, 'sección: ' + h)
    check(pg.is_visible('.ai-photo-svg image') and pg.is_visible('.ai-toggle:has-text("Repetir foto")'), 'la foto sigue visible al final, con "Repetir foto"')
    check('Antes de tu sesión' not in txt, 'sin revisión previa cuando todas las respuestas de seguridad son "No"')
    check(txt.count('Evaluación orientativa con IA') == 1 and 'No es un diagnóstico' not in txt, 'una única aclaración')
    check(not re.search(r'\(\d+\)|%|[Aa]nálisis en prueba|[Pp]osibles? |No se observó|tipo de piel lo define', txt), 'sin conteos, porcentajes ni listas de lo no observado')
    check('Reservar evaluación y limpieza facial' in txt, 'botón de reserva con el texto del servicio')
    words = visible_words(pg); print('   palabras visibles:', words); check(words <= 140, f'resultado breve: {words} palabras visibles')
    print("   resumen:", pg.inner_text('.ai-summary'))
    n_badges = pg.eval_on_selector_all('.ai-chip', 'e=>e.length')
    print(f"   marcas: {n_badges} · círculos: {pg.eval_on_selector_all('.ai-badge', 'e=>e.length')} · anillos: {pg.eval_on_selector_all('.ai-ring', 'e=>e.length')}")
    check(not pg.is_visible('.ai-detail'), 'al inicio solo etiquetas breves: ninguna explicación abierta')
    pg.locator('#aiResult').screenshot(path=OUT + '/2-informe.png')
    if n_badges: marks_checks(pg, n_badges, '/3-marca-camara.png')
    check(not pg.evaluate("document.documentElement.scrollWidth > innerWidth"), 'sin scroll horizontal')
    pg.click('summary:has-text("Enviar este resumen")')
    pg.click('.ai-share button'); check('Marcá la casilla' in pg.inner_text('.ai-share .form-status'), 'no envía el resumen sin el consentimiento aparte')
    pg.check('#aiShareOk'); pg.click('.ai-share button'); pg.wait_for_timeout(900)
    check('Listo' in pg.inner_text('.ai-share .form-status'), 'envía el resumen con consentimiento')
    wa = pg.get_attribute('#aiResult a.btn-wa', 'href') or ''
    check('Mi%20solicitud' in wa and 'data%3Aimage' not in wa, 'WhatsApp con el resumen en texto')
    pg.click('#aiResult a.btn:has-text("Reservar")'); pg.wait_for_timeout(1500)
    top = pg.evaluate("document.querySelector('#reservar').getBoundingClientRect().top")
    check(abs(top) < 300 and pg.is_visible('#reservar'), f'el botón lleva a la reserva (arriba: {top:.0f}px)')
    pg.click('.ai-restart'); check(pg.is_visible('[data-ai="intro"]'), 'volver a empezar')
    pg.context.close()

    print("2. Permiso de cámara denegado")
    pg = page(perms=())
    pg.evaluate("() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); }")
    pg.click('#aiStart'); pg.wait_for_timeout(600)
    st = pg.inner_text('#aiCamStatus'); print('   ', st)
    check('permiso' in st and pg.is_visible('#aiCamSkip') and pg.is_visible('#aiCamUpload') and pg.is_visible('#aiCamRetry'), 'explica el problema y ofrece reintentar, subir foto o seguir sin foto')
    check(pg.is_visible('#reservar'), 'la landing sigue funcionando')
    pg.context.close()

    print("3. El modelo de IA no carga")
    pg = page(block_model=True)
    pg.click('#aiStart'); pg.wait_for_selector('#aiCamRetry:not([hidden])', timeout=35000)
    check('No pudimos cargar el análisis' in pg.inner_text('#aiCamStatus'), pg.inner_text('#aiCamStatus'))
    pg.click('#aiCamSkip'); check(pg.is_visible('#aiQ'), 'puede seguir sin foto')
    check(not pg.is_visible('#aiQ fieldset[data-k="en_cara"]'), 'sin foto no pregunta por la foto')
    answer_quiz(pg, medical=True); lead(pg)
    txt = pg.inner_text('#aiResult')
    check('Sin foto' in txt and 'ai-photo-svg' not in pg.inner_html('#aiResult'), 'informe sin foto: las respuestas no generan marcas')
    check('consultá con un médico o dermatólogo' in txt and pg.is_visible('.ai-review-box.is-medical'), 'lesión que sangra o cambia → consulta médica, a la vista')
    check('no es una solución' in txt, 'la reserva no se presenta como solución')
    check(pg.is_visible('.ai-addphoto'), 'ofrece sumar una foto')
    pg.locator('#aiResult').screenshot(path=OUT + '/4-sin-foto-revision-medica.png')
    pg.context.close()

    print("4. Fotos subidas que no sirven, y una que sí")
    pg = page(url="?demo=1&savefail=1&diagnostico=1")
    for name, expect in [('oscura', 'oscura'), ('quemada', 'luz'), ('borrosa', 'movida'), ('sinrostro', 'No encontramos un rostro'), ('dos', 'más de una persona')]:
        with pg.expect_file_chooser() as fc: pg.click('#aiUploadStart' if pg.is_visible('#aiUploadStart') else '#aiReviewUpload')
        fc.value.set_files(up[name]); pg.wait_for_function("document.querySelector('#aiReviewChecks li') !== null", timeout=40000)
        t = pg.inner_text('#aiReviewChecks'); check(expect in t and not pg.is_visible('#aiUse'), f'{name}: {t[:90]}')
    pg.locator('.ai-tool').screenshot(path=OUT + '/5-foto-rechazada.png')
    with pg.expect_file_chooser() as fc: pg.click('#aiReviewUpload')
    fc.value.set_files(up['marcada']); pg.wait_for_selector('#aiUse:not([hidden])', timeout=40000)
    print("   diag:", pg.inner_text('#aiDiag').replace('\n', '')[:3000] if pg.is_visible('#aiDiag') else '-')
    check('is-mirror' not in (pg.get_attribute('#aiReviewImg', 'class') or ''), 'una foto subida se muestra tal cual')
    pg.click('#aiUse'); check(pg.is_visible('#aiQ fieldset[data-k="filtro"]'), 'foto subida: pregunta por filtro o modo belleza')
    answer_quiz(pg); lead(pg)
    nb = pg.eval_on_selector_all('.ai-chip', 'e=>e.length'); print('   resumen:', pg.inner_text('.ai-summary'))
    print('   etiquetas:', pg.eval_on_selector_all('.ai-chip', 'e=>e.map(x=>x.textContent)'))
    check(nb > 0, f'foto con brillo y rojez: {nb} observaciones marcadas')
    check(not pg.evaluate("document.querySelector('.ai-photo-svg g').hasAttribute('transform')"), 'foto subida: sin espejo')
    pg.locator('#aiResult').screenshot(path=OUT + '/6-informe-con-marcas.png')
    check(pg.eval_on_selector_all('.ai-ring', 'e=>e.length') > 0, 'evidencia localizada: círculo alrededor de los reflejos o puntitos')
    if nb: marks_checks(pg, nb, '/7-marca-seleccionada.png')
    pg.click('summary:has-text("Enviar este resumen")')
    pg.check('#aiShareOk'); pg.click('.ai-share button'); pg.wait_for_timeout(900)
    check('No pudimos enviarlo' in pg.inner_text('.ai-share .form-status') and pg.is_enabled('.ai-share button'), 'si falla el envío lo informa y permite reintentar')
    print("5. Repetir foto desde el resultado")
    with pg.expect_file_chooser() as fc: pg.click('.ai-toggle:has-text("Repetir foto")')
    fc.value.set_files(up['buena']); pg.wait_for_selector('#aiUse:not([hidden])', timeout=40000)
    check(pg.inner_text('#aiReviewSkip') == 'Volver al resultado', 'durante la repetición se puede volver al resultado')
    pg.click('#aiUse'); step = pg.text_content('#aiQStep')
    check('Sobre la foto' in step and 'Ver mi resultado' in pg.inner_text('#aiQNext'), 'solo vuelve a preguntar lo de la foto: ' + step)
    answer_quiz(pg); pg.wait_for_selector('#aiResult:not([hidden])', timeout=10000)
    check(pg.is_visible('.ai-photo-svg image'), 'resultado nuevo con la foto nueva')
    print('   etiquetas con la foto nueva:', pg.eval_on_selector_all('.ai-chip', 'e=>e.map(x=>x.textContent)'))
    pg.context.close()
    b.close()
print("errores de la página:", errors)
print("RESULTADO:", "todo OK" if not fails and not errors else f"{len(fails)} fallas")
sys.exit(1 if fails or errors else 0)
