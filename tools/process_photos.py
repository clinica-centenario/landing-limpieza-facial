"""
Procesa fotos Nikon RAW (.NEF) para la web. Conserva los originales (solo los lee).

Paso 1 — revelar y hoja de contactos para inspección:
    python3 -I tools/process_photos.py develop <carpeta_nef> <carpeta_trabajo>
Paso 2 — exportar según la selección (layout.json) y generar public/photos.js:
    python3 -I tools/process_photos.py export <carpeta_trabajo> <layout.json> <carpeta_public>

layout.json:
{
  "hero":    {"file": "DSC_XXXX", "alt": "...", "position": "50% 40%"},
  "pro":     {"file": "DSC_XXXX", "alt": "..."} | null,
  "gallery": [{"file": "DSC_XXXX", "alt": "...", "wide": true}, ...],
  "adjust":  {"DSC_XXXX": {"exposure": 1.1, "rotate": 0, "crop": [l, t, r, b]}}
}
Ajustes permitidos: exposición, rotación y recorte. No se retoca piel ni resultados del tratamiento.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageOps
import rawpy

try:
    import pillow_avif  # noqa: F401  (registra AVIF en Pillow si está instalado)
    HAS_AVIF = True
except Exception:
    HAS_AVIF = hasattr(Image, "registered_extensions") and ".avif" in Image.registered_extensions()

WIDTHS = [480, 800, 1200, 1600]


def develop(src_dir, work_dir):
    os.makedirs(work_dir, exist_ok=True)
    files = sorted(f for f in os.listdir(src_dir) if f.lower().endswith(".nef"))
    if not files:
        sys.exit("No hay .NEF en " + src_dir)
    report = {}
    thumbs = []
    for f in files:
        stem = os.path.splitext(f)[0]
        with rawpy.imread(os.path.join(src_dir, f)) as raw:
            # Balance de blancos de la cámara, gamma sRGB, orientación según EXIF (flip automático de rawpy).
            rgb = raw.postprocess(use_camera_wb=True, no_auto_bright=False, auto_bright_thr=0.005,
                                  output_bps=8, output_color=rawpy.ColorSpace.sRGB, highlight_mode=rawpy.HighlightMode.Blend)
        img = Image.fromarray(rgb)
        arr = np.asarray(img.convert("L"), dtype=np.float32)
        stats = {"w": img.width, "h": img.height, "mean": round(float(arr.mean()), 1),
                 "p02": float(np.percentile(arr, 2)), "p98": float(np.percentile(arr, 98))}
        # Corrección natural de exposición: si la media queda muy baja o muy alta, ajuste suave de ganancia.
        target = 118.0
        gain = 1.0
        if stats["mean"] < 95 or stats["mean"] > 150:
            gain = max(0.75, min(1.45, target / max(stats["mean"], 1)))
            img = Image.fromarray(np.clip(np.asarray(img, dtype=np.float32) * gain, 0, 255).astype(np.uint8))
        stats["auto_gain"] = round(gain, 3)
        img.save(os.path.join(work_dir, stem + ".png"))  # intermedio sin metadatos
        report[stem] = stats
        t = img.copy(); t.thumbnail((640, 640)); thumbs.append((stem, t))
    # Hoja de contactos con nombre
    from PIL import ImageDraw
    cols = 2
    cw, ch = 640, 480 + 30
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw, rows * ch), "white")
    d = ImageDraw.Draw(sheet)
    for i, (stem, t) in enumerate(thumbs):
        x, y = (i % cols) * cw, (i // cols) * ch
        sheet.paste(t, (x + (cw - t.width) // 2, y + 30 + (480 - t.height) // 2))
        d.text((x + 10, y + 8), f"{stem}  {t.width}x{t.height}", fill="black")
    sheet.save(os.path.join(work_dir, "_contact_sheet.jpg"), quality=85)
    json.dump(report, open(os.path.join(work_dir, "_report.json"), "w"), indent=1)
    print(json.dumps(report, indent=1))


def _load(work_dir, stem, adj):
    img = Image.open(os.path.join(work_dir, stem + ".png")).convert("RGB")
    a = adj.get(stem, {})
    if a.get("rotate"):
        img = img.rotate(-a["rotate"], expand=True)
    if a.get("crop"):
        img = img.crop(tuple(a["crop"]))
    if a.get("exposure") and a["exposure"] != 1:
        img = Image.fromarray(np.clip(np.asarray(img, dtype=np.float32) * a["exposure"], 0, 255).astype(np.uint8))
    return img


def _export(img, out_dir, slug):
    os.makedirs(out_dir, exist_ok=True)
    res = {"jpg": [], "webp": [], "avif": []}
    widths = [w for w in WIDTHS if w <= img.width] or [img.width]
    for w in widths:
        h = round(img.height * w / img.width)
        r = img.resize((w, h), Image.LANCZOS)
        # Pillow no copia EXIF/GPS salvo que se pase explícitamente: archivos sin metadatos.
        r.save(os.path.join(out_dir, f"{slug}-{w}.jpg"), "JPEG", quality=80, optimize=True, progressive=True)
        r.save(os.path.join(out_dir, f"{slug}-{w}.webp"), "WEBP", quality=78, method=6)
        res["jpg"].append(f"img/{slug}-{w}.jpg {w}w"); res["webp"].append(f"img/{slug}-{w}.webp {w}w")
        if HAS_AVIF:
            r.save(os.path.join(out_dir, f"{slug}-{w}.avif"), "AVIF", quality=55)
            res["avif"].append(f"img/{slug}-{w}.avif {w}w")
    mid = widths[min(1, len(widths) - 1)]
    return {
        "jpg": ", ".join(res["jpg"]), "webp": ", ".join(res["webp"]), "avif": ", ".join(res["avif"]) or None,
        "fallback": f"img/{slug}-{mid}.jpg", "width": widths[-1], "height": round(img.height * widths[-1] / img.width)
    }


def export(work_dir, layout_path, public_dir):
    layout = json.load(open(layout_path))
    adj = layout.get("adjust", {})
    out_dir = os.path.join(public_dir, "img")
    photos = {"hero": None, "pro": None, "gallery": []}
    for key in ("hero", "pro"):
        item = layout.get(key)
        if item:
            ph = _export(_load(work_dir, item["file"], adj), out_dir, f"{key}-{item['file'].lower()}")
            ph.update({"alt": item["alt"], "position": item.get("position")})
            photos[key] = ph
    for i, item in enumerate(layout.get("gallery", [])):
        ph = _export(_load(work_dir, item["file"], adj), out_dir, f"g{i+1}-{item['file'].lower()}")
        ph.update({"alt": item["alt"], "wide": bool(item.get("wide")), "position": item.get("position")})
        photos["gallery"].append(ph)
    js = "/* Generado por tools/process_photos.py — no editar a mano. */\nwindow.CC_PHOTOS = " + json.dumps(photos, ensure_ascii=False, indent=1) + ";\n"
    open(os.path.join(public_dir, "photos.js"), "w").write(js)
    # Preload de la imagen principal en index.html
    if photos["hero"]:
        h = photos["hero"]
        typ, srcset = ("image/avif", h["avif"]) if h.get("avif") else ("image/webp", h["webp"])
        tag = f'<link rel="preload" as="image" type="{typ}" imagesrcset="{srcset}" imagesizes="(min-width: 900px) 520px, 100vw" fetchpriority="high">'
        idx = os.path.join(public_dir, "index.html")
        html = open(idx).read()
        import re
        html = re.sub(r"<!--HERO_PRELOAD-->|<link rel=\"preload\" as=\"image\"[^>]*>", tag, html, count=1)
        open(idx, "w").write(html)
    print("Exportado:", sorted(os.listdir(out_dir)))


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "develop":
        develop(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 5 and sys.argv[1] == "export":
        export(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        print(__doc__)
