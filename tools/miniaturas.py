"""
Miniaturas ligeras de las curvas de luz para las rejillas (portada, Observaciones, «lámina anterior / siguiente»).

Por cada observación de obs/observaciones.json cuya miniatura (`thumb`) es un PNG (las curvas de tránsito, 1600 px y
600-850 KB), escribe al lado <nombre>-m.webp: 800 px de ancho (Lanczos), WebP con pérdida calidad 85. build_atlas.py la
usa en las rejillas si existe (thumb_src); la lámina de detalle sigue enlazando y mostrando el PNG original. No toca
observaciones.json.
Por qué WebP y no JPG (medido el 12-11-2026 con la curva de WASP-59 b, 800 px): JPG q90 4:4:4 141 KB, JPG q82 4:4:4
106 KB, JPG q85 4:2:0 99 KB, WebP q80 61 KB, WebP q88 79 KB; ampliados al doble, el texto fino se lee igual en los cinco.

Uso (desde la raíz del repo; necesita Pillow, que ya está instalado en esta máquina):
    python tools/miniaturas.py            escribe las que falten o estén desfasadas (más viejas que su original)
    python tools/miniaturas.py --todas    las rehace todas
Después, la cadena de siempre: build_atlas.py -> sync_nav.py -> seo_inject.py.
Reproducible: mismo original y misma versión de Pillow -> mismo fichero.
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIDTH = 800
QUALITY = 85


def small_name(rel):
    return os.path.splitext(rel)[0] + "-m.webp"          # build_atlas.py thumb_src() looks for this same name


def make(src, dst):
    from PIL import Image          # imported here: the rest of the site build does not need Pillow
    with Image.open(src) as im:
        im.load()
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGB", im.size, im.getpixel((0, 0))[:3])      # the plot's own background colour
            bg.paste(im, mask=im.getchannel("A"))
            im = bg
        else:
            im = im.convert("RGB")
        h = round(im.height * WIDTH / im.width)
        im = im.resize((WIDTH, h), Image.LANCZOS)
        im.save(dst, "WEBP", quality=QUALITY, method=6)
    return WIDTH, h


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--todas", action="store_true", help="rehacerlas todas")
    a = ap.parse_args()
    try:
        import PIL  # noqa: F401
    except ImportError:
        sys.exit("Falta Pillow (pip install Pillow). La web funciona sin miniaturas: las rejillas usan el original.")
    data = json.load(open(os.path.join(ROOT, "obs", "observaciones.json"), encoding="utf-8"))
    made = kept = 0
    for o in data:
        t = o.get("thumb")
        if not t or not t.lower().endswith(".png"):
            continue
        src, dst = os.path.join(ROOT, t), os.path.join(ROOT, small_name(t))
        if not os.path.isfile(src):
            print(f"  falta el original: {t}")
            continue
        if not a.todas and os.path.isfile(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
            kept += 1
            continue
        w, h = make(src, dst)
        made += 1
        print(f"  {small_name(t)}  {w}x{h}  {os.path.getsize(dst) / 1024:.0f} KB  (original {os.path.getsize(src) / 1024:.0f} KB)")
    print(f"miniaturas: {made} escritas, {kept} ya al día.")


if __name__ == "__main__":
    main()
