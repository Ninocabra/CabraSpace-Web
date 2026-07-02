"""
Fuente UNICA del motor pi-workflow: los fragmentos ordenados de src/piw/*.js.
pi-workflow.js se GENERA concatenandolos dentro del IIFE (prefijo/sufijo de aqui)
y, si esbuild esta disponible, se emite ademas pi-workflow.min.js + sourcemap.

Flujo de edicion (A5, Fase 6):
    1. Edita SOLO los fragmentos de src/piw/ (estan numerados en orden de carga;
       todos comparten el MISMO ambito del IIFE: una funcion de un fragmento puede
       usar funciones/estado de otro, exactamente igual que antes del troceo).
    2. python tools/build_piw.py          -> regenera pi-workflow.js (+ .min.js si hay esbuild)
       python tools/build_piw.py --check  -> verifica sin escribir (CI/pre-push)
    3. Sube el BUILD (?v= y PIW_BUILD en el HTML ES + tools/build_workflow_en.py)
       si quieres invalidar caches, y commitea fragmentos + generados.

NO edites pi-workflow.js a mano: el siguiente build pisaria el cambio.
"""
import glob
import io
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "src", "piw")
OUT = os.path.join(ROOT, "pi-workflow.js")
OUT_MIN = os.path.join(ROOT, "pi-workflow.min.js")

PREFIX = """/* =========================================================================
 * pi-workflow.js — Motor de Procesado y UI de PI Workflow
 *
 * ARCHIVO GENERADO por tools/build_piw.py desde los fragmentos de src/piw/
 * (NO editar a mano: edita el fragmento y regenera).
 *
 * Coordina las operaciones cliente de pre-procesado, estirado, máscaras
 * y mezcla de canales directamente en el navegador.
 * ========================================================================= */

(function () {
  "use strict";

"""

SUFFIX = "})();\n"


def fragments():
    files = sorted(glob.glob(os.path.join(SRC_DIR, "[0-9][0-9]-*.js")))
    if not files:
        sys.exit("ERROR: no hay fragmentos en src/piw/")
    return files


def generate():
    parts = [PREFIX]
    for f in fragments():
        parts.append(io.open(f, encoding="utf-8", newline="").read())
    parts.append(SUFFIX)
    return "".join(parts)


def run_esbuild():
    """Minificado + sourcemap con esbuild (npx). Si no esta disponible, se omite con aviso."""
    cmd = ["npx", "--no-install", "esbuild", OUT,
           "--minify", "--sourcemap", "--target=es2020",
           "--charset=utf8", "--outfile=" + OUT_MIN]
    try:
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=(os.name == "nt"))
    except FileNotFoundError:
        print("AVISO: npx no encontrado; se omite pi-workflow.min.js")
        return False
    if r.returncode != 0:
        print("AVISO: esbuild fallo; se omite pi-workflow.min.js\n" + (r.stderr or r.stdout))
        return False
    print("esbuild OK -> %s (+ .map)" % os.path.basename(OUT_MIN))
    return True


def main():
    result = generate()
    if "--check" in sys.argv:
        with io.open(OUT, encoding="utf-8", newline="") as f:
            current = f.read()
        if current == result:
            print("OK: pi-workflow.js esta al dia con src/piw/.")
        else:
            print("DESFASE: pi-workflow.js no coincide con los fragmentos de src/piw/. Ejecuta tools/build_piw.py.")
            sys.exit(1)
        return
    with io.open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write(result)
    n = len(fragments())
    print("Generado pi-workflow.js desde %d fragmentos de src/piw/ (%d KB)." % (n, len(result.encode("utf-8")) // 1024))
    run_esbuild()


if __name__ == "__main__":
    main()
