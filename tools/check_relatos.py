"""
check_relatos.py — fidelidad de los relatos publicados en las láminas frente a su fuente única, RELATOS.md (F4).

Por cada lámina que tiene relato en RELATOS.md comprueba, en la página ES generada:
  1. el TEXTO: cada párrafo de la página (sin marcado y sin llamadas) es idéntico al de RELATOS.md (sin llamadas);
  2. las LLAMADAS: mismas y en el mismo orden ([1], [8, 9], [9, inf.]…), una a una;
  3. las REFERENCIAS: mismo número de entradas, numeradas 1..n, y en cada una los MISMOS enlaces que su línea de
     RELATOS.md (ni uno más ni uno menos);
  4. cada llamada apunta a una referencia que existe; si hay [inf.], la nota que lo explica está en la página.
Y en la página EN: mismo número de párrafos, mismas llamadas y mismos enlaces que la ES (el texto inglés no se compara:
es traducción; ver propuestas-estetica/d4-investigacion/RELATOS-EN.md).

Uso (desde la raíz del repo):
    python tools/check_relatos.py [--relatos <RELATOS.md>] [--dir <carpeta con las páginas>]
Salida 0 = todo fiel; 1 = alguna diferencia (se lista cada una); 2 = no se pudo comprobar (falta un fichero…).
"""
import argparse
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RELATOS_DEFAULT = os.path.normpath(os.path.join(ROOT, "..", "propuestas-estetica", "d4-investigacion", "RELATOS.md"))
CALL = re.compile(r"\s*\[((?:\d+|inf\.)(?:,\s*(?:\d+|inf\.))*)\]")
URL = re.compile(r"https?://[^\s`]+")


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def parse_relatos(path):
    text = open(path, encoding="utf-8").read()
    out = {}
    for sec in re.split(r"^## ", text, flags=re.M)[1:]:
        m = re.search(r"^`slug: ([a-z0-9-]+)`", sec, re.M)
        if not m or "**Relato**" not in sec:
            continue
        body = sec.split("**Relato**", 1)[1].split("**Referencias**", 1)
        paras = [p.strip() for p in re.split(r"\n\s*\n", body[0]) if p.strip()]
        refs = {int(r.group(1)): [u.rstrip(".,;)") for u in URL.findall(r.group(2))]
                for r in re.finditer(r"^(\d+)\. (.+)$", body[1].split("**Trazabilidad**", 1)[0], re.M)}
        out[m.group(1)] = {
            "text": [norm(CALL.sub("", p)) for p in paras],
            "calls": [[x.strip() for x in c.split(",")] for p in paras for c in CALL.findall(p)],
            "refs": refs,
        }
    return out


def page_of(o, lang):
    base = o.get("page") or {"transit": f"transito-{o['slug']}.html", "deep-sky": f"cielo-{o['slug']}.html",
                             "eclipse": f"{o['slug']}.html"}[o["kind"]]
    return base if lang == "es" else base[:-5] + "-en.html"


def parse_page(path):
    t = open(path, encoding="utf-8").read()
    m = re.search(r'<div class="prosa relato">(.*?)</div>', t, re.S)
    paras = re.findall(r"<p>(.*?)</p>", m.group(1), re.S) if m else []
    text, calls = [], []
    for p in paras:
        for sup in re.findall(r'<sup class="cita">(.*?)</sup>', p, re.S):
            calls.append([html.unescape(norm(re.sub(r"<[^>]+>", "", a))) for a in re.findall(r"<a\b[^>]*>.*?</a>", sup, re.S)])
        plain = re.sub(r'<sup class="cita">.*?</sup>', "", p, flags=re.S)
        text.append(norm(html.unescape(re.sub(r"<[^>]+>", "", plain))))
    refs = {}
    sec = re.search(r'<section class="refs".*?</section>', t, re.S)
    if sec:
        for li in re.finditer(r'<li id="ref-(\d+)">(.*?)</li>', sec.group(0), re.S):
            refs[int(li.group(1))] = [html.unescape(h) for h in re.findall(r'<a href="([^"]+)"', li.group(2))]
    return {"text": text, "calls": calls, "refs": refs, "has_inf_note": 'id="nota-inf"' in t, "found": bool(m)}


def check(rel, pages_dir, obs):
    fails = []
    by_slug = {o["slug"]: o for o in obs}
    for slug, r in rel.items():
        o = by_slug.get(slug)
        if not o:
            fails.append((slug, "no está en observaciones.json"))
            continue
        pes, pen = (os.path.join(pages_dir, page_of(o, l)) for l in ("es", "en"))
        if not (os.path.isfile(pes) and os.path.isfile(pen)):
            fails.append((slug, "falta la página ES o EN"))
            continue
        es, en = parse_page(pes), parse_page(pen)
        if not es["found"]:
            fails.append((slug, "la página ES no lleva relato"))
            continue
        # 1. text
        if len(es["text"]) != len(r["text"]):
            fails.append((slug, f"{len(es['text'])} párrafos en la página, {len(r['text'])} en RELATOS"))
        for i, (a, b) in enumerate(zip(es["text"], r["text"]), 1):
            if a != b:
                k = next((j for j, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
                fails.append((slug, f"¶{i} distinto en el carácter {k}:\n      página   …{a[max(0, k - 40):k + 40]}…\n      RELATOS  …{b[max(0, k - 40):k + 40]}…"))
        # 2. calls
        if es["calls"] != r["calls"]:
            fails.append((slug, f"llamadas distintas:\n      página   {es['calls']}\n      RELATOS  {r['calls']}"))
        # 3. references
        if sorted(es["refs"]) != list(range(1, len(r["refs"]) + 1)) or len(es["refs"]) != len(r["refs"]):
            fails.append((slug, f"referencias: la página tiene {sorted(es['refs'])}, RELATOS 1..{len(r['refs'])}"))
        for n, urls in r["refs"].items():
            if es["refs"].get(n, []) != urls:
                fails.append((slug, f"[{n}] enlaces distintos:\n      página   {es['refs'].get(n)}\n      RELATOS  {urls}"))
        # 4. targets
        for c in es["calls"]:
            for x in c:
                if x == "inf.":
                    if not es["has_inf_note"]:
                        fails.append((slug, "hay [inf.] pero falta la nota que lo explica"))
                elif int(x) not in es["refs"]:
                    fails.append((slug, f"la llamada {x} no tiene referencia"))
        # EN twin: same structure
        if len(en["text"]) != len(es["text"]):
            fails.append((slug, f"EN: {len(en['text'])} párrafos, ES {len(es['text'])}"))
        if en["calls"] != es["calls"]:
            fails.append((slug, f"EN: llamadas distintas de la ES:\n      EN {en['calls']}\n      ES {es['calls']}"))
        if en["refs"] != es["refs"]:
            fails.append((slug, "EN: referencias o enlaces distintos de la ES"))
    return fails


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--relatos", default=RELATOS_DEFAULT)
    ap.add_argument("--dir", default=ROOT)
    a = ap.parse_args()
    try:
        rel = parse_relatos(a.relatos)
        obs = json.load(open(os.path.join(ROOT, "obs", "observaciones.json"), encoding="utf-8"))
    except OSError as e:
        print(f"No se pudo comprobar: {e}")
        return 2
    if not rel:
        print("RELATOS.md no tiene ningún relato: no se ha comprobado nada")
        return 2
    fails = check(rel, a.dir, obs)
    bad = {s for s, _ in fails}
    for slug, r in rel.items():
        n_calls, n_refs = len(r["calls"]), len(r["refs"])
        print(f"  {'FALLA' if slug in bad else 'ok   '}  {slug:22s} {len(r['text'])} ¶ · {n_calls:2d} llamadas · {n_refs:2d} referencias")
    for slug, msg in fails:
        print(f"  - {slug}: {msg}")
    print(f"check_relatos: {len(rel) - len(bad)}/{len(rel)} láminas fieles a RELATOS.md" + (f", {len(fails)} diferencias" if fails else ""))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
