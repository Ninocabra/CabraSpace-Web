"""
Fuente unica del menu de navegacion. Reemplaza el <header id="navbar"> de las 24 paginas con
el menu canonico (ES/EN) definido aqui. El resaltado de la seccion activa lo hace mobile-menu.js
por URL (no se incrusta `active` en el HTML), asi el menu es identico en todas las paginas salvo
el conmutador de idioma (que apunta al gemelo de cada pagina).

Para cambiar el menu: edita ES_TEMPLATE / EN_TEMPLATE aqui y ejecuta:
    python tools/sync_nav.py     (desde la raiz del repo)
Idempotente: re-ejecutar regenera el bloque.
"""
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TWIN_OVERRIDES = {"index.html": "en.html", "en.html": "index.html"}

MARKER = '<!-- NAV-AUTO: menu generado por tools/sync_nav.py; editar ahi y re-ejecutar -->'

ES_TEMPLATE = '''<header id="navbar">
    ''' + MARKER + '''
    <div class="container nav-container">
      <a href="__HOME_HREF__" class="logo-link">
        <img src="logo.webp" alt="CabraSpace Logo">
        <span>CabraSpace</span>
      </a>

      <button class="hamburger-btn" id="hamburger-btn" aria-label="Abrir menú" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>

      <ul class="nav-menu">
        <li><a href="__HOME_HREF__" class="nav-link">Inicio</a></li>
        <li class="dropdown">
          <a href="#" class="nav-link dropdown-toggle">Novedades <span class="arrow">▾</span></a>
          <ul class="dropdown-menu">
            <li><a href="equipamiento.html" class="dropdown-item">Equipamiento</a></li>
            <li><a href="novedades.html" class="dropdown-item">PixInsight</a></li>
          </ul>
        </li>
        <li><a href="pi-workflow.html" class="nav-link">PI Workflow (BETA)</a></li>
        <li class="dropdown">
          <a href="#" class="nav-link dropdown-toggle">Astrofotografía <span class="arrow">▾</span></a>
          <ul class="dropdown-menu">
            <li><a href="astroforecast.html" class="dropdown-item">Astro Forecast</a></li>
            <li class="dropdown-submenu">
              <a href="#" class="dropdown-item dropdown-toggle">Recursos PixInsight <span class="arrow">▸</span></a>
              <ul class="dropdown-menu">
                <li><a href="cabrascripts.html" class="dropdown-item">CabraScripts</a></li>
                <li><a href="pixelmath.html" class="dropdown-item">PixelMath-teca</a></li>
                <li><a href="cursos-youtube.html" class="dropdown-item">Cursos Youtube</a></li>

                <li><a href="autoghs.html" class="dropdown-item">AutoGHS</a></li>
              </ul>
            </li>
            <li class="dropdown-submenu">
              <a href="#" class="dropdown-item dropdown-toggle">Contaminación Lumínica <span class="arrow">▸</span></a>
              <ul class="dropdown-menu">
                <li><a href="contaminacion-mapa.html" class="dropdown-item">Mapa de Contaminación</a></li>
                <li><a href="contaminacion.html" class="dropdown-item">Vídeos y Guías</a></li>
              </ul>
            </li>
          </ul>
        </li>
        <li class="dropdown">
          <a href="#" class="nav-link dropdown-toggle">Divulgación <span class="arrow">▾</span></a>
          <ul class="dropdown-menu">
            <li><a href="divulgacion-coffeebreak.html" class="dropdown-item">Coffee Break: señal y ruido</a></li>
          </ul>
        </li>
      </ul>

      <div style="display: flex; align-items: center; gap: 16px;">
        <button id="nightmode-toggle" class="nightmode-btn" aria-label="Modo Noche" title="Modo Noche Astronómico">
          <svg class="moon-red-icon" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
        </button>
        <div class="lang-switcher">
          <a href="__ES_HREF__" class="lang-link active">ES</a>
          <span class="lang-separator">|</span>
          <a href="__EN_HREF__" class="lang-link">EN</a>
        </div>
      </div>
    </div>
  </header>'''

EN_TEMPLATE = '''<header id="navbar">
    ''' + MARKER + '''
    <div class="container nav-container">
      <a href="__HOME_HREF__" class="logo-link">
        <img src="logo.webp" alt="CabraSpace Logo">
        <span>CabraSpace</span>
      </a>

      <button class="hamburger-btn" id="hamburger-btn" aria-label="Open menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>

      <ul class="nav-menu">
        <li><a href="__HOME_HREF__" class="nav-link">Home</a></li>
        <li class="dropdown">
          <a href="#" class="nav-link dropdown-toggle">Latest News <span class="arrow">▾</span></a>
          <ul class="dropdown-menu">
            <li><a href="equipamiento-en.html" class="dropdown-item">Equipment</a></li>
            <li><a href="novedades-en.html" class="dropdown-item">PixInsight</a></li>
          </ul>
        </li>
        <li><a href="pi-workflow-en.html" class="nav-link">PI Workflow (BETA)</a></li>
        <li class="dropdown">
          <a href="#" class="nav-link dropdown-toggle">Astrophotography <span class="arrow">▾</span></a>
          <ul class="dropdown-menu">
            <li><a href="astroforecast-en.html" class="dropdown-item">Astro Forecast</a></li>
            <li class="dropdown-submenu">
              <a href="#" class="dropdown-item dropdown-toggle">PixInsight Resources <span class="arrow">▸</span></a>
              <ul class="dropdown-menu">
                <li><a href="cabrascripts-en.html" class="dropdown-item">CabraScripts</a></li>
                <li><a href="pixelmath-en.html" class="dropdown-item">PixelMath-teca</a></li>
                <li><a href="cursos-youtube-en.html" class="dropdown-item">YouTube Courses</a></li>

                <li><a href="autoghs-en.html" class="dropdown-item">AutoGHS</a></li>
              </ul>
            </li>
            <li class="dropdown-submenu">
              <a href="#" class="dropdown-item dropdown-toggle">Light Pollution <span class="arrow">▸</span></a>
              <ul class="dropdown-menu">
                <li><a href="contaminacion-mapa-en.html" class="dropdown-item">Light Pollution Map</a></li>
                <li><a href="contaminacion-en.html" class="dropdown-item">Videos & Guides</a></li>
              </ul>
            </li>
          </ul>
        </li>
        <li class="dropdown">
          <a href="#" class="nav-link dropdown-toggle">Outreach <span class="arrow">▾</span></a>
          <ul class="dropdown-menu">
            <li><a href="divulgacion-coffeebreak-en.html" class="dropdown-item">Coffee Break: señal y ruido</a></li>
          </ul>
        </li>
      </ul>

      <div style="display: flex; align-items: center; gap: 16px;">
        <button id="nightmode-toggle" class="nightmode-btn" aria-label="Night Mode" title="Astronomical Night Mode">
          <svg class="moon-red-icon" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
        </button>
        <div class="lang-switcher">
          <a href="__ES_HREF__" class="lang-link">ES</a>
          <span class="lang-separator">|</span>
          <a href="__EN_HREF__" class="lang-link active">EN</a>
        </div>
      </div>
    </div>
  </header>'''


def lang_of(f):
    return "en" if (f == "en.html" or f.endswith("-en.html")) else "es"


def twin_of(f):
    if f in TWIN_OVERRIDES:
        return TWIN_OVERRIDES[f]
    if f.endswith("-en.html"):
        return f[:-len("-en.html")] + ".html"
    return f[:-len(".html")] + "-en.html"


def build_header(fname):
    lang = lang_of(fname)
    twin = twin_of(fname)
    es_file = fname if lang == "es" else twin
    en_file = fname if lang == "en" else twin
    home_href = "index.html" if lang == "es" else "en.html"
    tpl = ES_TEMPLATE if lang == "es" else EN_TEMPLATE
    return (tpl.replace("__HOME_HREF__", home_href)
               .replace("__ES_HREF__", es_file)
               .replace("__EN_HREF__", en_file))


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "*.html")))
    header_re = re.compile(r'<header id="navbar">.*?</header>', re.S)
    changed = skipped = 0
    for path in files:
        fname = os.path.basename(path)
        txt = open(path, encoding="utf-8", errors="replace").read()
        if not header_re.search(txt):
            print(f"  (sin <header id=navbar>, omitido) {fname}")
            skipped += 1
            continue
        new = header_re.sub(lambda m: build_header(fname), txt, count=1)
        if new != txt:
            open(path, "w", encoding="utf-8", newline="").write(new)
            changed += 1
    print(f"Menu sincronizado: {changed} paginas actualizadas, {skipped} omitidas.")


if __name__ == "__main__":
    main()
