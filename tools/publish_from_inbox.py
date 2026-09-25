"""
Publicador: lleva a la web los paquetes que los programas dejan en inbox/.

Un paquete es una carpeta  inbox/<slug>/  con:
  - ficha.json : UNA entrada con el mismo formato que obs/observaciones.json, pero
                 con los ficheros nombrados sin ruta ("curva.png", no "obs/<slug>/curva.png").
                 Opcional: "_publicador": {"reemplazar": true} para sustituir una
                 observación que ya está en la web (sin eso, un slug repetido se rechaza).
  - los ficheros que nombra la ficha (imágenes, vídeo).

Uso, desde la raíz del repo:
    python tools/publish_from_inbox.py              valida, copia, regenera y SE PARA
    python tools/publish_from_inbox.py --comprobar  solo valida; no toca nada
    python tools/publish_from_inbox.py --subir      commit + push de lo que dejó la pasada anterior

Qué hace con cada paquete:
  - válido     -> copia a obs/<slug>/, entra en observaciones.json, el paquete va a inbox/_publicados/
  - no válido  -> no toca la web; el paquete va a inbox/_rechazados/ con MOTIVO.txt
Después ejecuta los tres comandos de siempre (build_atlas, sync_nav, seo_inject), comprueba que
cada página nueva existe, y enseña qué ha cambiado. NUNCA sube solo: eso es --subir.
"""
import argparse
import datetime
import html
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INBOX = os.path.join(ROOT, "inbox")
OBS_DIR = os.path.join(ROOT, "obs")
OBS_JSON = os.path.join(OBS_DIR, "observaciones.json")
BUILD = ["tools/build_atlas.py", "tools/sync_nav.py", "tools/seo_inject.py"]

KINDS = ("deep-sky", "transit", "eclipse")
MEDIA_TYPES = ("image", "plot", "video")
MAX_BYTES = {".jpg": 8e6, ".jpeg": 8e6, ".png": 8e6, ".webp": 8e6, ".mp4": 30e6}
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,60}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Only these paths may change in a publication; --subir refuses anything else.
PUBLISHABLE = re.compile(r"^(obs/|[a-z0-9-]+\.html$|sitemap\.xml$)")


# ---------------------------------------------------------------- validation
def bilingual(o, key, errors, required=True):
    v = o.get(key)
    if v is None and not required:
        return
    if not isinstance(v, dict) or not all(isinstance(v.get(l), str) and v.get(l).strip() for l in ("es", "en")):
        errors.append(f"'{key}' debe tener texto en 'es' y en 'en'")


def validate(pkg_dir, ficha, known_slugs, published=()):
    """Returns the list of problems (empty = valid). Never modifies anything."""
    e = []
    slug = ficha.get("slug")
    if not isinstance(slug, str) or not SLUG_RE.match(slug):
        e.append("'slug' falta o no es válido (minúsculas, cifras y guiones)")
    elif slug != os.path.basename(pkg_dir):
        e.append(f"la carpeta se llama '{os.path.basename(pkg_dir)}' pero el slug es '{slug}'")
    if ficha.get("kind") not in KINDS:
        e.append(f"'kind' debe ser uno de {KINDS}")
    if not isinstance(ficha.get("object"), str) or not ficha["object"].strip():
        e.append("falta 'object' (qué se observó)")
    d = ficha.get("date_iso")
    if not isinstance(d, str) or not DATE_RE.match(d):
        e.append("'date_iso' debe ser AAAA-MM-DD")
    else:
        try:
            datetime.date.fromisoformat(d)
        except ValueError:
            e.append(f"'date_iso' no es una fecha real: {d}")
    for k in ("title", "subtitle", "description"):
        bilingual(ficha, k, e)
    bilingual(ficha, "title_html", e, required=False)

    # Every fact with a value must say where it came from: that is what makes the page checkable.
    facts = ficha.get("facts")
    if not isinstance(facts, dict) or not facts:
        e.append("faltan 'facts' (los datos, cada uno con su 'source')")
    else:
        for name, f in facts.items():
            if not isinstance(f, dict) or "value" not in f:
                e.append(f"el dato '{name}' debe ser {{\"value\": ..., \"source\": ...}}")
            elif f["value"] not in (None, "") and not (isinstance(f.get("source"), str) and f["source"].strip()):
                e.append(f"el dato '{name}' tiene valor pero no dice de dónde sale ('source')")
    fd = ficha.get("facts_display")
    if not isinstance(fd, dict) or not all(isinstance(fd.get(l), list) and fd.get(l) for l in ("es", "en")):
        e.append("'facts_display' debe tener filas en 'es' y en 'en'")
    else:
        for l in ("es", "en"):
            for row in fd[l]:
                if not (isinstance(row, list) and len(row) == 2 and all(isinstance(c, str) for c in row)):
                    e.append(f"'facts_display.{l}': cada fila debe ser [\"etiqueta\", \"valor\"]")
                    break

    # Files: bare names, present in the package, sane size, and every one used.
    files = ficha.get("files")
    if not isinstance(files, list) or not files:
        e.append("'files' debe listar los ficheros del paquete")
        files = []
    for name in files:
        if not isinstance(name, str) or "/" in name or "\\" in name or name.startswith("."):
            e.append(f"en 'files', '{name}' debe ser un nombre sin ruta")
            continue
        p = os.path.join(pkg_dir, name)
        ext = os.path.splitext(name)[1].lower()
        if not os.path.isfile(p):
            e.append(f"falta el fichero '{name}'")
        elif ext not in MAX_BYTES:
            e.append(f"'{name}': tipo no admitido (vale {', '.join(sorted(MAX_BYTES))})")
        elif os.path.getsize(p) > MAX_BYTES[ext]:
            e.append(f"'{name}' pesa {os.path.getsize(p) / 1e6:.1f} MB (máximo {MAX_BYTES[ext] / 1e6:.0f} MB)")
        elif os.path.getsize(p) == 0:
            e.append(f"'{name}' está vacío")
    listed = set(files)
    extra = sorted(set(os.listdir(pkg_dir)) - listed - {"ficha.json"})
    if extra:
        e.append(f"hay ficheros que 'files' no nombra: {', '.join(extra)}")

    refs = [("thumb", ficha.get("thumb")), ("og", ficha.get("og"))]
    media = ficha.get("media")
    if not isinstance(media, list) or not media:
        e.append("'media' debe tener al menos una figura")
        media = []
    for i, m in enumerate(media):
        if not isinstance(m, dict) or m.get("type") not in MEDIA_TYPES:
            e.append(f"media[{i}]: 'type' debe ser uno de {MEDIA_TYPES}")
            continue
        refs.append((f"media[{i}].src", m.get("src")))
        if m["type"] == "video":
            refs.append((f"media[{i}].poster", m.get("poster")))
        else:
            bilingual(m, "alt", e)
        bilingual(m, "caption", e, required=False)
    for where, name in refs:
        if name not in listed:
            e.append(f"'{where}' = {name!r} no está en 'files'")

    # Nights that are part of a combined page live only there (Nino, 25-09-2026).
    nights = ficha.get("nights") or []
    for o in published:
        if (o.get("slug") != slug and o.get("kind") == "transit" == ficha.get("kind")
                and o.get("object") == ficha.get("object") and len(o.get("nights") or []) > 1
                and set(nights) & set(o["nights"])):
            e.append(f"la noche {', '.join(sorted(set(nights) & set(o['nights'])))} ya está en la página "
                     f"combinada '{o['slug']}'; las noches de un combinado solo se publican allí")
    meta = ficha.get("_publicador", {})
    if slug in known_slugs and not meta.get("reemplazar"):
        e.append(f"'{slug}' ya está en la web; para sustituirla, pon \"_publicador\": {{\"reemplazar\": true}}")
    return e


# ---------------------------------------------------------------- publishing
def to_site_paths(ficha):
    """Bare names -> the paths observaciones.json uses (files: '<slug>/x', the rest: 'obs/<slug>/x')."""
    slug = ficha["slug"]
    o = {k: v for k, v in ficha.items() if not k.startswith("_")}
    o["files"] = [f"{slug}/{n}" for n in ficha["files"]]
    web = lambda n: f"obs/{slug}/{n}"
    for k in ("thumb", "og"):
        if o.get(k):
            o[k] = web(o[k])
    o["media"] = [dict(m, src=web(m["src"]), **({"poster": web(m["poster"])} if m.get("poster") else {}))
                  for m in ficha["media"]]
    return o


def read_obs():
    raw = open(OBS_JSON, encoding="utf-8").read()
    data = json.loads(raw)
    if dump(data) != raw:
        sys.exit("observaciones.json no tiene el formato de siempre (indent=1, UTF-8); no lo toco")
    return data


def dump(data):
    return json.dumps(data, ensure_ascii=False, indent=1) + "\n"


def move_package(pkg_dir, where, stamp):
    dest = os.path.join(INBOX, where, f"{stamp}_{os.path.basename(pkg_dir)}")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.move(pkg_dir, dest)
    return dest


def git(*args):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        sys.exit(f"git {' '.join(args)} falló:\n{r.stderr}")
    return r.stdout


def dirty_paths():
    # --ignore-cr-at-eol is not available for status: diff tells real changes, status adds new files.
    changed = git("diff", "--ignore-cr-at-eol", "--name-only").split()
    new = [l[3:] for l in git("status", "--porcelain", "-uall").splitlines() if l.startswith("??")]
    return sorted(set(changed + new))


def packages():
    if not os.path.isdir(INBOX):
        return []
    return sorted(os.path.join(INBOX, n) for n in os.listdir(INBOX)
                  if not n.startswith(("_", ".")) and os.path.isdir(os.path.join(INBOX, n)))


def publish(check_only):
    pkgs = packages()
    if not pkgs:
        print("El buzón está vacío: nada que publicar.")
        return 0
    if not check_only:
        dirty = dirty_paths()
        if dirty:
            sys.exit("El repo tiene cambios sin subir; publica con el repo limpio para no mezclarlos:\n  "
                     + "\n  ".join(dirty))

    data = read_obs()
    known = {o["slug"] for o in data}
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    ok, bad = [], []
    for pkg in pkgs:
        try:
            ficha = json.load(open(os.path.join(pkg, "ficha.json"), encoding="utf-8"))
            errors = validate(pkg, ficha, known, data) if isinstance(ficha, dict) else ["ficha.json no es un objeto"]
        except FileNotFoundError:
            ficha, errors = None, ["falta ficha.json"]
        except json.JSONDecodeError as ex:
            ficha, errors = None, [f"ficha.json no es JSON válido: {ex}"]
        name = os.path.basename(pkg)
        if errors:
            bad.append((name, errors))
            if not check_only:
                dest = move_package(pkg, "_rechazados", stamp)
                open(os.path.join(dest, "MOTIVO.txt"), "w", encoding="utf-8").write("\n".join(errors) + "\n")
            continue
        ok.append((pkg, ficha))

    for name, errors in bad:
        print(f"RECHAZADO  {name}")
        for x in errors:
            print(f"    - {x}")
    for pkg, ficha in ok:
        print(f"{'ACTUALIZA' if ficha['slug'] in known else 'NUEVA    '}  {ficha['slug']}")
    if check_only or not ok:
        if not check_only and bad:
            print("\nLos rechazados están en inbox/_rechazados/ con su MOTIVO.txt.")
        return 1 if bad else 0

    for pkg, ficha in ok:
        slug = ficha["slug"]
        dest = os.path.join(OBS_DIR, slug)
        if os.path.isdir(dest):
            shutil.rmtree(dest)  # replacing: the package is the whole truth for this observation
        os.makedirs(dest)
        for n in ficha["files"]:
            shutil.copy2(os.path.join(pkg, n), os.path.join(dest, n))
        entry = to_site_paths(ficha)
        if slug in known:   # replace in place: the diff of observaciones.json shows only what changed
            data = [entry if o["slug"] == slug else o for o in data]
        else:
            data.append(entry)
    open(OBS_JSON, "w", encoding="utf-8", newline="\n").write(dump(data))

    for script in BUILD:
        r = subprocess.run([sys.executable, script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        if r.returncode:
            sys.exit(f"{script} falló (el buzón sigue intacto; deshaz con 'git checkout -- . && git clean -fd -- obs *.html'):\n"
                     f"{r.stdout}\n{r.stderr}")

    # Did each observation really get its page? Exit 0 is not proof.
    missing = []
    for _, ficha in ok:
        page = ficha.get("page") or {"transit": f"transito-{ficha['slug']}.html",
                                     "deep-sky": f"cielo-{ficha['slug']}.html",
                                     "eclipse": f"{ficha['slug']}.html"}[ficha["kind"]]
        for p in (page, page.replace(".html", "-en.html")):
            full = os.path.join(ROOT, p)
            title = ficha["title"]["en" if p.endswith("-en.html") else "es"]
            text = open(full, encoding="utf-8").read() if os.path.isfile(full) else ""
            if title not in text and html.escape(title) not in text:
                missing.append(p)
    if missing:
        sys.exit("Se ejecutó todo pero estas páginas no salen o no llevan su título: " + ", ".join(missing))

    for pkg, _ in ok:
        move_package(pkg, "_publicados", stamp)
    changed = dirty_paths()
    print(f"\nListo y SIN SUBIR. Cambian {len(changed)} ficheros:")
    for p in changed:
        print(f"  {p}")
    print("\nRevisa en local (páginas de arriba). Si está bien:  python tools/publish_from_inbox.py --subir")
    print("Si no:  git checkout -- . && git clean -fd -- obs *.html   (el paquete sigue en inbox/_publicados/)")
    return 0


def upload():
    changed = dirty_paths()
    if not changed:
        print("No hay nada pendiente de subir.")
        return 0
    stray = [p for p in changed if not PUBLISHABLE.match(p)]
    if stray:
        sys.exit("Hay cambios que no son de una publicación; no subo nada:\n  " + "\n  ".join(stray))
    slugs = sorted({p.split("/")[1] for p in changed if p.startswith("obs/") and p.count("/") >= 2})
    git("add", "--", *changed)
    git("commit", "-q", "-m", f"Publicador: {', '.join(slugs) or 'observaciones'}")
    git("pull", "-q", "--rebase")
    git("push", "-q")
    print(f"Subido: {', '.join(slugs) or 'observaciones'}. Vercel lo publica en un par de minutos.")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--comprobar", action="store_true", help="solo valida los paquetes")
    g.add_argument("--subir", action="store_true", help="commit + push de la última publicación")
    a = ap.parse_args()
    sys.exit(upload() if a.subir else publish(a.comprobar))
