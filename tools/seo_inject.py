"""
Inyecta etiquetas SEO sociales/idiomáticas en el <head> de todas las páginas y regenera
sitemap.xml + robots.txt. Idempotente: re-ejecutar no duplica (salta si ya hay canonical).

Añade por página: canonical, hreflang ES/EN/x-default, Open Graph y Twitter Card.
Uso:  python tools/seo_inject.py     (desde la raíz del repo)
"""
import os
import re
import glob

SITE = "https://cabraspace.com"
DEFAULT_OG_IMAGE = f"{SITE}/logo.png"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Pares ES <-> EN. index.html es el único cuyo gemelo no sigue el patrón "-en".
TWIN_OVERRIDES = {"index.html": "en.html", "en.html": "index.html"}


def twin_of(fname):
    if fname in TWIN_OVERRIDES:
        return TWIN_OVERRIDES[fname]
    if fname.endswith("-en.html"):
        return fname[:-len("-en.html")] + ".html"
    return fname[:-len(".html")] + "-en.html"


def url_for(fname):
    # index.html -> URL raíz (la que la gente enlaza); el resto, su nombre de fichero.
    if fname == "index.html":
        return f"{SITE}/"
    return f"{SITE}/{fname}"


def lang_of(fname):
    return "en" if (fname == "en.html" or fname.endswith("-en.html")) else "es"


def extract(txt, pattern):
    m = re.search(pattern, txt, re.S)
    return m.group(1).strip() if m else ""


def build_block(fname):
    """Construye el bloque SEO para una página, resolviendo su gemelo de idioma."""
    path = os.path.join(ROOT, fname)
    txt = open(path, encoding="utf-8", errors="replace").read()
    title = extract(txt, r"<title>(.*?)</title>")
    desc = extract(txt, r'<meta name="description" content="([^"]*)"')

    lang = lang_of(fname)
    twin = twin_of(fname)
    es_file = fname if lang == "es" else twin
    en_file = fname if lang == "en" else twin

    self_url = url_for(fname)
    es_url = url_for(es_file)
    en_url = url_for(en_file)
    ogtype = "website" if fname in ("index.html", "en.html") else "article"

    return f"""  <!-- SEO-AUTO-BEGIN (generado por tools/seo_inject.py; no editar a mano) -->
  <link rel="canonical" href="{self_url}">
  <link rel="alternate" hreflang="es" href="{es_url}">
  <link rel="alternate" hreflang="en" href="{en_url}">
  <link rel="alternate" hreflang="x-default" href="{es_url}">
  <meta property="og:type" content="{ogtype}">
  <meta property="og:site_name" content="CabraSpace">
  <meta property="og:locale" content="{'es_ES' if lang == 'es' else 'en_GB'}">
  <meta property="og:url" content="{self_url}">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{desc}">
  <meta property="og:image" content="{DEFAULT_OG_IMAGE}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{title}">
  <meta name="twitter:description" content="{desc}">
  <meta name="twitter:image" content="{DEFAULT_OG_IMAGE}">
  <!-- SEO-AUTO-END -->
"""


def inject_all():
    files = sorted(glob.glob(os.path.join(ROOT, "*.html")))
    changed = 0
    for path in files:
        fname = os.path.basename(path)
        txt = open(path, encoding="utf-8", errors="replace").read()
        # Idempotencia: si ya está el bloque, lo reemplazamos (re-genera con datos frescos).
        block = build_block(fname)
        if "SEO-AUTO-BEGIN" in txt:
            new = re.sub(r"  <!-- SEO-AUTO-BEGIN.*?SEO-AUTO-END -->\n",
                         block, txt, flags=re.S)
        else:
            new = txt.replace("</head>", block + "</head>", 1)
        if new != txt:
            open(path, "w", encoding="utf-8").write(new)
            changed += 1
            print(f"  SEO -> {fname}")
    print(f"Inyectadas/actualizadas {changed} paginas.")


def write_sitemap():
    files = sorted(glob.glob(os.path.join(ROOT, "*.html")))
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
             '        xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for path in files:
        fname = os.path.basename(path)
        self_url = url_for(fname)
        es_url = url_for(fname if lang_of(fname) == "es" else twin_of(fname))
        en_url = url_for(fname if lang_of(fname) == "en" else twin_of(fname))
        lines.append("  <url>")
        lines.append(f"    <loc>{self_url}</loc>")
        lines.append(f'    <xhtml:link rel="alternate" hreflang="es" href="{es_url}"/>')
        lines.append(f'    <xhtml:link rel="alternate" hreflang="en" href="{en_url}"/>')
        lines.append(f'    <xhtml:link rel="alternate" hreflang="x-default" href="{es_url}"/>')
        lines.append("  </url>")
    lines.append("</urlset>")
    open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"sitemap.xml: {len(files)} URLs")


def write_robots():
    content = f"User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n"
    open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8").write(content)
    print("robots.txt escrito")


if __name__ == "__main__":
    inject_all()
    write_sitemap()
    write_robots()
