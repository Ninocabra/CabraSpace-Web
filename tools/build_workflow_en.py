"""
Fuente UNICA del CabraSpace Imaging Workflow: cabraspace-imaging-workflow.html (ES).
La version inglesa (-en.html) se GENERA desde el ES aplicando las traducciones de
tools/i18n_workflow_en.json (bloques de lineas completas ES -> EN, en orden).

Flujo de edicion (A2, Fase 5):
    1. Edita SOLO cabraspace-imaging-workflow.html.
    2. Si tocaste texto visible/comentarios/metas, anade o actualiza su entrada en
       tools/i18n_workflow_en.json (el JSON es una lista de {"es": ..., "en": ...};
       cada bloque son lineas COMPLETAS tal cual, sin el salto de linea final).
    3. python tools/build_workflow_en.py        -> regenera -en.html
       python tools/build_workflow_en.py --check -> verifica sin escribir (CI/pre-push)
    4. Revisa el diff de -en.html y commitea ambos + el JSON.

El generador es line-oriented: recorre el ES linea a linea y, cuando las proximas N
lineas coinciden EXACTAMENTE con el bloque "es" de una entrada (gana el bloque mas
largo), emite el bloque "en" en su lugar. Un mismo bloque puede aplicar varias veces
(p. ej. "vacio" x4). Errores duros si una entrada no aplica nunca (traduccion
obsoleta) o si dos entradas comparten el mismo bloque "es" con distinto "en"
(ambiguedad: amplia el bloque con lineas de contexto).

    --extract  reconstruye el JSON desde los dos HTML actuales (difflib). Solo para
               el bootstrap inicial o para re-sincronizar tras editar -en.html a mano
               (no lo hagas: edita el ES + JSON).
"""
import difflib
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ES_PATH = os.path.join(ROOT, "cabraspace-imaging-workflow.html")
EN_PATH = os.path.join(ROOT, "cabraspace-imaging-workflow-en.html")
JSON_PATH = os.path.join(ROOT, "tools", "i18n_workflow_en.json")


def read_lines(path):
    with io.open(path, encoding="utf-8", newline="") as f:
        text = f.read()
    # keepends para preservar los finales de linea tal cual esten en el repo
    return text.splitlines(keepends=True)


def strip_eol(line):
    return line.rstrip("\r\n")


def eol_of(line):
    return line[len(strip_eol(line)):]


def extract():
    es_lines = read_lines(ES_PATH)
    en_lines = read_lines(EN_PATH)
    es_plain = [strip_eol(l) for l in es_lines]
    en_plain = [strip_eol(l) for l in en_lines]
    sm = difflib.SequenceMatcher(a=es_plain, b=en_plain, autojunk=False)
    # cada hunk guarda tambien las lineas IGUALES que le siguen, para poder ampliar
    # contexto si el mismo bloque ES traduce distinto segun donde aparezca
    hunks = []  # [es_block_lines, en_block_lines, ctx_lines]
    ops = sm.get_opcodes()
    for k, (tag, i1, i2, j1, j2) in enumerate(ops):
        if tag == "equal":
            continue
        ctx = []
        if k + 1 < len(ops) and ops[k + 1][0] == "equal":
            n1, n2 = ops[k + 1][1], ops[k + 1][2]
            ctx = es_plain[n1:min(n2, n1 + 3)]
        hunks.append([list(es_plain[i1:i2]), list(en_plain[j1:j2]), ctx])

    def occurrences_in_es(block_lines):
        L = len(block_lines)
        return sum(1 for i in range(len(es_plain) - L + 1)
                   if all(es_plain[i + k] == block_lines[k] for k in range(L)))

    # dedupe conservando el orden. Un bloque ES es AMBIGUO si (a) traduce distinto en
    # dos hunks, o (b) aparece en el fichero mas veces que como hunk (las otras
    # apariciones son identicas en EN y NO deben traducirse). En ambos casos se
    # amplia el bloque con lineas de contexto compartidas hasta que sea unico.
    for _round in range(4):
        seen = {}
        counts = {}
        ambiguous = set()
        for es_b, en_b, _ctx in hunks:
            key = "\n".join(es_b)
            counts[key] = counts.get(key, 0) + 1
            if key in seen and seen[key] != "\n".join(en_b):
                ambiguous.add(key)
            seen.setdefault(key, "\n".join(en_b))
        for es_b, _en_b, _ctx in hunks:
            key = "\n".join(es_b)
            if key not in ambiguous and occurrences_in_es(es_b) > counts[key]:
                ambiguous.add(key)
        if not ambiguous:
            break
        for h in hunks:
            key = "\n".join(h[0])
            if key in ambiguous:
                if not h[2]:
                    print("AMBIGUO sin contexto disponible; resuelvelo a mano:\n" + key)
                    sys.exit(2)
                nxt = h[2].pop(0)
                h[0].append(nxt)
                h[1].append(nxt)
    else:
        print("AMBIGUEDAD persistente tras ampliar contexto; resuelvelo a mano:")
        for c in sorted(ambiguous):
            print("---\n" + c)
        sys.exit(2)

    seen = {}
    unique = []
    for es_b, en_b, _ctx in hunks:
        key = "\n".join(es_b)
        if key in seen:
            continue
        seen[key] = True
        unique.append({"es": key, "en": "\n".join(en_b)})
    with io.open(JSON_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(unique, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("Extraidas %d entradas -> %s" % (len(unique), os.path.relpath(JSON_PATH, ROOT)))


def generate():
    with io.open(JSON_PATH, encoding="utf-8") as f:
        entries = json.load(f)
    # indice: primera linea ES -> entradas (bloques mas largos primero)
    by_first = {}
    for e in entries:
        es_lines = e["es"].split("\n")
        by_first.setdefault(es_lines[0], []).append((es_lines, e["en"].split("\n") if e["en"] != "" else [], e))
    for k in by_first:
        by_first[k].sort(key=lambda t: -len(t[0]))

    src = read_lines(ES_PATH)
    out = []
    used = {id(e): 0 for _, __, e in [t for lst in by_first.values() for t in lst]}
    i = 0
    n = len(src)
    while i < n:
        plain = strip_eol(src[i])
        matched = None
        for es_lines, en_lines, e in by_first.get(plain, ()):  # el mas largo primero
            L = len(es_lines)
            if i + L <= n and all(strip_eol(src[i + k]) == es_lines[k] for k in range(L)):
                matched = (es_lines, en_lines, e)
                break
        if matched:
            es_lines, en_lines, e = matched
            eol = eol_of(src[i]) or "\n"
            out.extend(l + eol for l in en_lines)
            used[id(e)] += 1
            i += len(es_lines)
        else:
            out.append(src[i])
            i += 1

    stale = [e["es"] for _, __, e in [t for lst in by_first.values() for t in lst] if used[id(e)] == 0]
    if stale:
        print("ERROR: %d traducciones NO aplicaron (el ES cambio; actualiza el JSON):" % len(stale))
        for s in stale[:10]:
            print("---\n" + s)
        sys.exit(2)
    return "".join(out)


def main():
    if "--extract" in sys.argv:
        extract()
        return
    result = generate()
    if "--check" in sys.argv:
        with io.open(EN_PATH, encoding="utf-8", newline="") as f:
            current = f.read()
        if current == result:
            print("OK: cabraspace-imaging-workflow-en.html esta al dia.")
        else:
            cur = current.splitlines()
            new = result.splitlines()
            diff = list(difflib.unified_diff(cur, new, "actual", "generado", lineterm="", n=0))
            print("DESFASE: -en.html no coincide con lo generado (%d lineas de diff)." % len(diff))
            for d in diff[:40]:
                print(d)
            sys.exit(1)
        return
    with io.open(EN_PATH, "w", encoding="utf-8", newline="") as f:
        f.write(result)
    print("Generado %s desde el ES + %d traducciones." % (os.path.basename(EN_PATH),
          len(json.load(io.open(JSON_PATH, encoding="utf-8")))))


if __name__ == "__main__":
    main()
