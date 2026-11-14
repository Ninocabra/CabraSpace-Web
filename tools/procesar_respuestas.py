"""Lee por IMAP las respuestas del dueño al resumen diario y publica las candidatas que elija.

Lo lanza .github/workflows/curacion_respuestas.yml cada hora. Flujo:
  1. Si no hay ningún resumen con candidatas sin contestar, NO abre IMAP (nada que hacer).
  2. Busca en la bandeja correos recientes con «CB-» en el asunto.
  3. Cada correo pasa el filtro de seguridad (curacion.check_message): remitente EXACTO del dueño,
     Authentication-Results de Gmail con dkim=pass y spf=pass, y ser una respuesta (no el propio resumen).
  4. Se interpreta el texto escrito (sin la parte citada), se aplica al resumen al que contesta y se
     guarda la decisión (aceptadas Y rechazadas). Un correo ya aplicado (hash de su Message-ID) o un
     resumen ya resuelto no se vuelven a aplicar.
  5. Lo aceptado entra en equipamiento.json, se regeneran latest.json y el catálogo.

REGISTRO: solo recuentos. Nunca direcciones, contraseña ni cuerpos (repo y logs públicos).
Variables: GMAIL_APP_PASSWORD, RESUMEN_USER (cuenta del buzón) y RESUMEN_TO (dueño: único remitente válido).
"""
import os
import sys
import json
import imaplib
import subprocess
from collections import Counter
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import curacion as cu  # noqa: E402

ROOT = cu.ROOT
EQUIPO_FILE = os.path.join(ROOT, "equipamiento.json")
ENVIADOS_FILE = os.path.join(ROOT, "tools", "resumen_enviados.json")
MAX_DB_SIZE = 250          # el mismo tope que scraper_equipment.py


def imap_date(dt):
    return dt.strftime("%d-%b-%Y")   # IMAP exige mes en inglés: no usar el locale


def connect(user, password):
    """Gmail muestra la contraseña de aplicación en grupos de 4 con espacios: se quitan todos."""
    m = imaplib.IMAP4_SSL("imap.gmail.com", 993, timeout=30)
    m.login(user, "".join(password.split()))
    return m


def fetch_raw_messages(imap, since):
    """Correos de la bandeja desde `since` con «CB-» en el asunto. Solo lectura (BODY.PEEK)."""
    typ, _ = imap.select("INBOX", readonly=True)
    if typ != "OK":
        raise RuntimeError("IMAP: no se pudo abrir INBOX")
    typ, data = imap.search(None, "SINCE", imap_date(since), "SUBJECT", "CB-")
    if typ != "OK":
        raise RuntimeError("IMAP: la búsqueda falló")
    out = []
    for num in (data[0].split() if data and data[0] else []):
        typ, parts = imap.fetch(num, "(BODY.PEEK[])")
        if typ == "OK" and parts and isinstance(parts[0], tuple):
            out.append(parts[0][1])
    return out


def mark_sent(published_ids):
    """Lo publicado desde el correo ya lo vio el dueño: que no se le re-envíe como «novedad»."""
    if not published_ids:
        return
    state = cu.load_json(ENVIADOS_FILE, None)
    if state is None:
        return
    state["sent"] = list(dict.fromkeys(list(published_ids) + state.get("sent", [])))[:3000]
    cu.save_json(ENVIADOS_FILE, state)


def rebuild_derived(db):
    """latest.json (portada) y catálogo en Markdown, igual que al final del scraper."""
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_latest.py")], check=True, cwd=ROOT,
                   stdout=subprocess.DEVNULL)
    import scraper_equipment as se
    se.print = lambda *a, **k: None       # sustituir el print del módulo; NO redirect_stdout (ficha metodo/)
    se.regenerate_markdown_catalog(db)


def process(raws, owner, cands, digests, decisions, db, now=None):
    """Núcleo sin red: aplica los correos `raws` (bytes). Muta los documentos; devuelve (db, recuento, ids publicados)."""
    now = now or cu.utcnow()
    count = Counter()
    published_ids = []
    open_ids = cu.open_digests(digests, now)
    seen = set(digests["processed"])
    for raw in raws:
        count["leidos"] += 1
        try:
            msg = cu.parse_message(raw)
        except Exception:
            count["rechazado_ilegible"] += 1
            continue
        ok, why = cu.check_message(msg, owner)
        if not ok:
            count["rechazado_" + why] += 1
            continue
        key = cu.message_key(msg)
        if key is None:
            count["rechazado_sin_id"] += 1
            continue
        if key in seen:
            count["ya_procesado"] += 1
            continue
        digest_id = cu.find_digest_id(msg)
        if digest_id is None or digest_id not in digests["digests"]:
            count["rechazado_sin_resumen"] += 1
            continue
        seen.add(key)
        cu.mark_processed(digests, key)
        if digest_id not in open_ids:
            count["resumen_ya_resuelto_o_viejo"] += 1
            continue
        n = len(digests["digests"][digest_id]["ids"])
        parsed = cu.parse_reply(cu.extract_text(msg), n)
        if parsed.action is None:
            count["no_entendido"] += 1
            continue
        res = cu.apply_reply(cands, digests, decisions, digest_id, parsed, now)
        if res is None:
            count["resumen_ya_resuelto_o_viejo"] += 1
            continue
        pub, rejected, gone = res
        db, ids = cu.publish_items(db, pub, MAX_DB_SIZE)
        published_ids += ids
        open_ids.pop(digest_id, None)
        count["respuestas_aplicadas"] += 1
        count["publicadas"] += len(ids)
        count["rechazadas"] += rejected
        count["ya_no_estaban"] += gone
        if parsed.ignored:
            count["numeros_fuera_de_rango"] += parsed.ignored
    return db, count, published_ids


def main(imap_factory=None, derived=True):
    user = os.environ.get("RESUMEN_USER", "").strip()
    owner = os.environ.get("RESUMEN_TO", "").strip() or user
    password = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    if not user or not owner or (not password and imap_factory is None):
        print("ERROR: faltan GMAIL_APP_PASSWORD o RESUMEN_USER/RESUMEN_TO.")
        return 1

    cands = cu.load_candidatas(cu.CANDIDATAS_FILE)
    digests = cu.load_digests(cu.DIGESTS_FILE)
    decisions = cu.load_decisiones(cu.DECISIONES_FILE)
    now = cu.utcnow()
    pending = cu.open_digests(digests, now)
    if not pending:
        print("Sin resúmenes con candidatas por contestar: no se abre el buzón.")
        return 0
    oldest = min(datetime.fromisoformat(v["sent"]) for v in pending.values())
    print(f"{len(pending)} resumen(es) con candidatas por contestar.")

    imap = (imap_factory or (lambda: connect(user, password)))()
    try:
        raws = fetch_raw_messages(imap, oldest - timedelta(days=1))
    finally:
        try:
            imap.logout()
        except Exception:
            pass

    db = cu.load_json(EQUIPO_FILE, [])
    db, count, published_ids = process(raws, owner, cands, digests, decisions, db, now)
    print("Recuento: " + (", ".join(f"{k}={v}" for k, v in sorted(count.items())) or "nada"))

    cu.expire(cands, now)
    cu.save_json(cu.DIGESTS_FILE, digests)
    cu.save_json(cu.DECISIONES_FILE, decisions)
    cu.save_json(cu.CANDIDATAS_FILE, cands)
    if published_ids:
        _save_equipo(db)
        mark_sent(published_ids)
        if derived:
            rebuild_derived(db)
        print(f"Publicadas en la Bitácora: {len(published_ids)}")
    return 0


def _save_equipo(db):
    # mismo formato que scraper_equipment.save_database (indent=2): diffs mínimos en git
    with open(EQUIPO_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    sys.exit(main())
