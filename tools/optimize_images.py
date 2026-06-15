"""
Convierte los PNG pesados a WebP (mantiene los PNG originales como fallback / og:image),
reescribe las referencias en HTML/CSS/JS y añade loading="lazy" a las imagenes de contenido.
Idempotente y reproducible.  Uso:  python tools/optimize_images.py   (desde la raiz)

NO toca:
  - las URL absolutas de og:image/twitter:image (https://.../logo.png) -> los scrapers
    sociales no renderizan WebP de forma fiable, asi que la tarjeta sigue en PNG.
  - el favicon (cacheado una vez, ganancia minima).
  - imagenes muertas (youtube_banner, logo_transparente, logo_negro): se reportan, no se borran.
"""
import os
import re
import glob
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# PNG a convertir -> (ruta relativa). Se mantiene el original; se genera el .webp al lado.
TO_CONVERT = [
    "img/lightpollution-preview.png",
    "img/nightvis-preview.png",
    "pi-workflow-interface.png",
    "nebula_original.png", "nebula_stars.png", "nebula_starless.png",
    "nebula_ha.png", "nebula_oiii.png", "nebula_sii.png",
    "logo.png",
]

# Reemplazos de referencia (solo formas seguras; las og: absolutas quedan intactas).
REF_REPLACEMENTS = [
    ("img/lightpollution-preview.png", "img/lightpollution-preview.webp"),
    ("img/nightvis-preview.png", "img/nightvis-preview.webp"),
    ("'pi-workflow-interface.png'", "'pi-workflow-interface.webp'"),
    ("'nebula_original.png'", "'nebula_original.webp'"),
    ("'nebula_stars.png'", "'nebula_stars.webp'"),
    ("'nebula_starless.png'", "'nebula_starless.webp'"),
    ("'nebula_ha.png'", "'nebula_ha.webp'"),
    ("'nebula_oiii.png'", "'nebula_oiii.webp'"),
    ("'nebula_sii.png'", "'nebula_sii.webp'"),
    ('src="logo.png"', 'src="logo.webp"'),   # solo el atributo src; og:image (content=) no casa
]


def convert():
    total_before = total_after = 0
    for rel in TO_CONVERT:
        src = os.path.join(ROOT, rel)
        if not os.path.exists(src):
            print(f"  (falta {rel}, saltado)")
            continue
        dst = os.path.splitext(src)[0] + ".webp"
        im = Image.open(src)
        # Conserva transparencia (logo); convierte paleta/escala a un modo que WebP soporte.
        if im.mode in ("P", "LA"):
            im = im.convert("RGBA")
        elif im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGB")
        im.save(dst, "WEBP", quality=82, method=6)
        b = os.path.getsize(src)
        a = os.path.getsize(dst)
        total_before += b
        total_after += a
        print(f"  {rel:36} {b/1024:7.1f} KB -> {a/1024:7.1f} KB  ({100*a/b:.0f}%)")
    print(f"TOTAL imagenes: {total_before/1024:.1f} KB -> {total_after/1024:.1f} KB "
          f"(-{(total_before-total_after)/1024:.1f} KB)")


def rewrite_refs():
    files = glob.glob(os.path.join(ROOT, "*.html")) + glob.glob(os.path.join(ROOT, "*.css")) \
        + glob.glob(os.path.join(ROOT, "*.js"))
    changed = 0
    for path in files:
        txt = open(path, encoding="utf-8", errors="replace").read()
        new = txt
        for old, rep in REF_REPLACEMENTS:
            new = new.replace(old, rep)
        if new != txt:
            open(path, "w", encoding="utf-8").write(new)
            changed += 1
    print(f"Referencias reescritas en {changed} ficheros.")


def add_lazy_loading():
    """Anade loading=\"lazy\" a los <img> de contenido (no al logo, que va above-the-fold)."""
    files = glob.glob(os.path.join(ROOT, "*.html"))
    count = 0
    for path in files:
        txt = open(path, encoding="utf-8", errors="replace").read()

        def repl(m):
            tag = m.group(0)
            if "loading=" in tag or "logo" in tag:
                return tag
            return tag[:4] + ' loading="lazy"' + tag[4:]

        new = re.sub(r"<img\b[^>]*>", repl, txt)
        if new != txt:
            open(path, "w", encoding="utf-8").write(new)
            count += 1
    print(f"loading=lazy anadido en {count} ficheros.")


if __name__ == "__main__":
    print("Convirtiendo PNG -> WebP...")
    convert()
    print("\nReescribiendo referencias...")
    rewrite_refs()
    print("\nAnadiendo lazy-loading...")
    add_lazy_loading()
