import json
import requests
import re
import time
import os
import sys

def main():
    print("Starting Coffee Break outreach scraper...")
    
    # Load matching queries
    queries_file = "matching_queries.json"
    if not os.path.exists(queries_file):
        print(f"Error: {queries_file} not found!")
        sys.exit(1)
        
    with open(queries_file, "r", encoding="utf-8") as f:
        queries_list = json.load(f)
        
    print(f"Loaded {len(queries_list)} queries to process.")

    keywords_list = {
        "Mecánica Celeste y Astrometría": [
            "Aberración de la luz", "acimut", "acrónico", "afelio", "alineación planetaria", "altacimutal", "altura", 
            "anomalía excéntrica", "anomalía media", "anomalía verdadera", "antípoda", "ápex", "apogeo", "área de barrido", 
            "ascensión recta", "astrometría", "bólido", "brillante", "brillo aparente", "campo gravitatorio", "catadióptrico", 
            "centro de masa", "ciclo metónico", "ciclo saros", "círculo máximo", "coordenadas celestes", "coordenadas ecuatoriales", 
            "coordenadas galácticas", "culminación", "declinación", "deferente", "diámetro angular", "efemérides", "elipse", 
            "elíptica", "elongación", "ecuación del tiempo", "epiciclo", "época", "equinoccio", "esfera celeste", 
            "estrella circumpolar", "fase", "fulgor", "geocéntrico", "gravedad", "gravedad superficial", "heliocéntrico", 
            "horizonte", "hora sideral", "hora solar", "hora universal", "inclinación orbital", "interferometría", "isócrona", 
            "kepleriana", "latitud celeste", "latitud galáctica", "leyes de Kepler", "línea de los nodos", "longitud celeste", 
            "longitud de perihelio", "longitud galáctica", "longitud", "longitud del nodo ascendente", "luminosidad", 
            "magnitud absoluta", "magnitud aparente", "mecánica celeste", "meridiano", "meridiano local", "microrradián", 
            "milisegundo de arco", "momento angular", "movimiento directo", "movimiento estacionario", "movimiento propio", 
            "movimiento retrógrado", "nadir", "nodo", "nódulo", "nutación", "oblicuidad de la eclíptica", "ocultación", 
            "órbita", "paralaje", "periastro", "perigeo", "perihelio", "periodo orbital", "perturbación", "precesión", 
            "punto vernal", "radio vector", "radio orbital", "refracción atmosférica", "retrogradación", "revolución", 
            "semieje mayor", "semieje menor", "sistema de referencia", "solsticio", "tiempo dinámico", "tiempo universal coordinado", 
            "tránsito", "vector de estado", "velocidad de escape", "velocidad orbital", "velocidad radial", "velocidad tangencial", 
            "zenit", "zodíaco"
        ],
        "Cosmología y Cosmogonía": [
            "Anisotropía", "antimateria", "Big Bang", "Big Crunch", "Big Rip", "Big Bounce", "bosón", "brillo superficial", 
            "calentamiento global", "campo escalar", "campo tensorial", "colapso gravitacional", "constante cosmológica", 
            "constante de Hubble", "cosmología", "cosmología inflacionaria", "cosmogonía", "cosmología observacional", 
            "cosmología cuántica", "curvatura del espacio", "defecto topológico", "densidad crítica", "densidad de energía", 
            "desacoplamiento", "desplazamiento al rojo", "dimensión extra", "dominio de pared", "edad del universo", 
            "efecto Sunyaev-Zeldovich", "energía del vacío", "energía oscura", "entropía", "época de Planck", 
            "época inflacionaria", "era de la radiación", "era de la recombinación", "era de la materia", "espaciotiempo", 
            "espectro de potencia", "estructura a gran escala", "expansión métrica", "filamento galáctico", "flatulencia cósmica", 
            "fluctuación cuántica", "fuerza fundamental", "fotodesacoplamiento", "fondo cósmico de microondas", "galaxia oscura", 
            "gas intergaláctico", "geometría del universo", "glóbulo de Bok", "gradiente de densidad", "gravedad cuántica", 
            "grupo local", "horizonte de partículas", "inflación cósmica", "interacción débil", "interacción fuerte", 
            "in isotropía", "isotropía", "isocurvatura", "lente gravitacional", "longitud de coherencia", "longitud de onda", 
            "materia bariónica", "materia oscura", "materia oscura caliente", "materia oscura fría", "métrica de Friedman", 
            "métrica de Robertson-Walker", "microondas", "modelo Lambda-CDM", "modelo estándar", "multiverso", "nucleosíntesis", 
            "nucleosíntesis primordial", "nucleosíntesis estelar", "onda gravitacional", "parámetro de desaceleración", 
            "parámetro de densidad", "partícula elemental", "péndulo de Foucault", "periodo de inflación", "perturbación cosmológica", 
            "plasma primordial", "principio cosmológico", "principio antrópico", "radiación de fondo", "radiación de cuerpo negro", 
            "radiación fósil", "radio de Hubble", "radio de Schwarzschild", "redshift", "red cósmica", "reionización", 
            "ruptura de simetría", "singularidad", "supercúmulo", "teoría de cuerdas", "teoría de la relatividad", "universo", 
            "universo cerrado", "universo de De Sitter", "universo inflacionario", "universo observable", "universo abierto", 
            "universo estático", "vacío cuántico", "vacío cosmológico"
        ],
        "Astrofísica Estelar y Evolución": [
            "Abundancia química", "acreción", "acrecimiento", "agujero blanco", "agujero negro", "agujero negro estelar", 
            "agujero negro supermasivo", "análogo solar", "anillo de Einstein", "asociación estelar", "atmósfera estelar", 
            "berilio", "binaria astrométrica", "binaria de contacto", "binaria eclipsante", "binaria espectroscópica", 
            "binaria visual", "blazar", "brillo superficial", "brillo intrínseco", "brillo específico", "brillo estelar", 
            "brillantez", "brillantez superficial", "cadencia", "calentamiento coronal", "campo magnético estelar", 
            "captura neutrónica", "capa de convección", "capa de radiación", "carbono", "cataclismo", "cefeida", 
            "cefeida clásica", "cefeida de población II", "centro galáctico", "ciclo solar", "ciclo estelar", "cinturón de Gould", 
            "círculo de confusión", "clasificación espectral", "colapso estelar", "color estelar", "cometa", 
            "complejo molecular gigante", "composición química", "compresión gravitatoria", "condensación", 
            "conductividad térmica", "conexión magnética", "constelación", "convección", "conversión de masa", 
            "corona estelar", "corona solar", "corrimiento al rojo gravitacional", "cortina de polvo", "cúmulo abierto", 
            "cúmulo estelar", "cúmulo globular", "curva de luz", "ciclo estelar de actividad", "cuásar", "de Broglie", 
            "degeneración", "deuterio", "diagrama color-magnitud", "diagrama H-R", "disco de acreción", "disco de polvo", 
            "disco protoplanetario", "disco circunestelar", "dispersión", "dispersión de velocidades", "distancia focal", 
            "distancia estelar", "enana blanca", "enana marrón", "enana negra", "enana roja", "enana amarilla", 
            "enana naranja", "envoltura estelar", "erupción solar", "erupción estelar", "erupción cromosférica", 
            "escape térmico", "espectro de absorción", "espectro de emisión", "espectro continuo", "espectro electromagnético", 
            "espectroscopia", "estrella", "estrella binaria", "estrella de carbono", "estrella de hierro", "estrella de neutrones", 
            "estrella de quarks", "estrella doble", "estrella múltiple", "estrella pulsante", "estrella variable", 
            "estrella variable irregular", "estrella variable pulsante", "estrella simbiótica", "estrella fugaz", 
            "evolución estelar", "eyección de masa coronal", "eyección de masa", "factor de Boltzmann", "factor de Saha", 
            "filamento", "fisión nuclear", "flujo de energía", "flujo magnético", "forma de línea", "formación estelar", 
            "fotón", "fotosfera", "fractura de marea", "frecuencia de giro", "frecuencia de Larmor", "frecuencia de rotación", 
            "franja de inestabilidad", "frente de ionización", "frente de choque", "función de masa", "función de luminosidad", 
            "fusión de neutrones", "fusión nuclear", "galaxia", "galaxia activa", "galaxia barrada", "galaxia elíptica", 
            "galaxia espiral", "galaxia espiral barrada", "galaxia irregular", "galaxia lenticular", "galaxia nana", 
            "galaxia peculiar", "galaxia Seyfert", "galaxia starburst", "galaxia elíptica gigante", "gigante azul", 
            "gigante roja", "gigante naranja", "gigante brillante", "gigantes luminosas", "giro estelar", "glóbulo", 
            "gradiente térmico", "grano de polvo", "granulación", "gravedad superficial", "grupo moving", "grupo estelar", 
            "heliosfera", "hidrostática", "hidrógeno", "hipergigante", "hipernova", "ignición", "índice de color", 
            "inestabilidad gravitatoria", "inestabilidad hidrodinámica", "inyección de masa", "ionización", "isótopo", 
            "jets", "labio de Roche", "límite de Chandrasekhar", "límite de Eddington", "límite de Roche", "líneas de absorción", 
            "líneas de emisión", "líneas espectrales", "líneas prohibidas", "líneas permitidas", "longitud de onda", 
            "longitud de mezcla", "longitud de Jeans", "luminosidad", "luminosidad crítica", "luna", "lóbulo crítico", 
            "Lóbulo de Roche", "magnetar", "magnetohidrodinámica", "magnitud", "magnitud absoluta", "magnitud bolométrica", 
            "magnitud fotográfica", "magnitud visual", "magnitud de banda", "masa", "masa crítica", "masa de Jeans", 
            "masa estelar", "masa solar", "maser", "mecanismo de bombeo", "mecanismo de marea", "medio interestelar", 
            "metalicidad", "metalicidad estelar", "meteoro", "meteorito", "microondas", "microcuásar", "microlente", 
            "modelo estelar", "molécula", "momento magnético", "monóxido de carbono", "movimiento propio", "muón", 
            "nanotesla", "nebulosa", "nebulosa de emisión", "nebulosa de reflexión", "nebulosa oscura", "nebulosa planetaria", 
            "nebulosa del cangrejo", "nebulosa cabeza de caballo", "neutrinos", "nova", "núcleo", "núcleo activo", 
            "núcleo galáctico", "núcleo estelar", "opacidad", "opacidad estelar", "órbita", "oscilación estelar", 
            "oscurecimiento hacia el borde", "ozono", "paralaje", "parámetros estelares", "parsec", "partículas", 
            "polvo interestelar", "polvo cósmico", "pre-secuencia principal", "primaria", "principal", "procesos de nucleosíntesis", 
            "procesos s", "procesos r", "prominencia", "prominencia solar", "protuberancia", "protuberancia solar", 
            "protocúmulo", "protogalaxia", "protoestrella", "protón", "Pulsar", "púlsar binario", "púlsar de milisegundo", 
            "pulsación", "punto neutro", "punto subsolar", "punta de la rama de gigantes rojas", "quantum", "quarks", 
            "quasar", "radio", "radio astronómico", "radio de curvatura", "radio de emisión", "radio de giro", "radio galaxia", 
            "radio interferometría", "radio estrella", "radio estrella binaria", "radio fuent", "radio mapa", "radio telescopio", 
            "radio variable", "radioastronomía", "radiación", "radiación de fondo", "radiación de frenado", "radiación de sincrotrón", 
            "radiación electromagnética", "radiación gamma", "radiación infrarroja", "radiación ionizante", "radiación no térmica", 
            "radiación térmica", "radiación ultravioleta", "radiación X", "radiotelescopio", "radioisótopo", "rama de gigantes", 
            "rama asintótica", "rango de masas", "razón de masa", "razón de enfriamiento", "reacción en cadena", 
            "reacción nuclear", "reacciones de fusión", "reactores nucleares", "recombinación", "recombinación atómica", 
            "región H I", "región H II", "región de formación estelar", "región fotoionizada", "regla de masas", 
            "relación masa-luminosidad", "relación periodo-luminosidad", "resonancia orbital", "ráfaga rápida de radio", 
            "ráfaga solar", "ráfaga estelar", "ráfaga gamma", "ráfaga X", "saltador", "satélite", "satélite natural", 
            "sector magnético", "secular", "secuencia principal", "secuencia principal cero", "sequía", "severo", 
            "severidad", "sferics", "show", "sideral", "sigla", "señal", "señal débil", "señal fuerte", "señal electromagnética", 
            "señal de radio", "señal óptica", "señal recibida", "silicatos", "simetría", "sincrotrón", "singularidad", 
            "sistema", "sistema binario", "sistema de coordenadas", "sistema de espejos", "sistema de referencia", 
            "sistema estelar", "sistema planetario", "sistema solar", "sol", "solar", "solarización", "sonda", 
            "sonda espacial", "sonda interplanetaria", "sub-enana", "sub-gigante", "sub-milla", "sub-órbita", "supercúmulo", 
            "supergigante", "supergigante azul", "supergigante roja", "supergranulación", "supermasivo", "supernova", 
            "supernova de colapso", "supernova termonuclear", "superradiación", "supertierra", "sustrato", "tasa de acreción", 
            "tasa de enfriamiento", "tasa de formación estelar", "tasa de pérdida de masa", "tasa de reacción", "temperatura", 
            "temperatura aparente", "temperatura brillante", "temperatura de color", "temperatura de corte", "temperatura de cuerpo negro", 
            "temperatura de emisión", "temperatura de equilibrio", "temperatura de excitación", "temperatura de fondo", 
            "temperatura de ionización", "temperatura de la corona", "temperatura de la fotosfera", "temperatura de la superficie", 
            "temperatura efectiva", "temperatura electrónica", "temperatura cinética", "temperatura radiativa", 
            "temperatura rotacional", "temperatura spin", "temperatura vibracional", "temperatura virial", "temporal", 
            "terminador", "térmica", "termodinámica", "termonuclear", "tierra", "tipo espectral", "tono", "topología", 
            "trayectoria", "tránsito", "turbulencia", "turbulencia atmosférica", "turbulencia hidrodinámica", "ultravioleta", 
            "umbra", "unidad astronómica", "universo", "universo plano", "universo observable", "universo cerrado", 
            "universo abierto", "universo inflacionario", "universo estático", "universo en expansión", "universo oscilante", 
            "universo acelerado", "universo desacelerado", "universo homogéneo", "universo isótropo", "universo anisotrópico", 
            "vacío", "vacío cuántico", "vacío cosmológico", "variable", "variable cataclísmica", "variable de largo periodo", 
            "variable eruptiva", "variable pulsante", "variable rotacional", "variable binaria", "variable eclipsante", 
            "variable elipsoidal", "variable irregular", "variable semirregular", "variable Mira", "variable RR Lyrae", 
            "variable cefeida", "variable RV Tauri", "variable W Virginis", "variable Delta Scuti", "variable Beta Cephei", 
            "variable Alfa Cygni", "variable Gamma Doradus", "variable SX Phoenicis", "variable SX Arietis", 
            "variable Alpha2 Canum Venaticorum", "variable eruptiva rápida", "variable flare", "variable novae", 
            "variable supernovae", "variable simbiótica", "variable cataclísmica", "variable de tipo AM CVn", 
            "variable dwarf nova", "variable nova-like", "variable polar", "variable intermediate polar", 
            "variable cataclísmica magnética", "variable magnética", "variable X", "variable gamma", "variable ultravioleta", 
            "velocidad", "velocidad aparente", "velocidad crítica", "velocidad de deriva", "velocidad de escape", 
            "velocidad de fase", "velocidad de giro", "velocidad de grupo", "velocidad de la luz", "velocidad de recesión", 
            "velocidad de rotación", "velocidad de traslación", "velocidad de viento", "velocidad del sonido", 
            "velocidad del viento solar", "velocidad espacial", "velocidad peculiar", "velocidad radial", "velocidad relativa", 
            "velocidad sistemática", "velocidad tangencial", "velocidad terminal", "velocidad térmica", "velocidad turbulenta", 
            "viento estelar", "viento solar", "viento galáctico", "viento interestelar", "viento magnetosférico", "viento polar", 
            "viento ecuatorial", "viento coronal", "viento de acreción", "viento anómalo", "viento supersónico", "viento subsonico", 
            "vórtice", "vórtice atmosférico", "vórtice solar", "vórtice magnético", "vórtice polar", "rayos cósmicos", 
            "rayos gamma", "rayos infrarrojos", "rayos X", "rayos ultravioleta", "zona de convección", "zona de radiación", 
            "zona de seguridad", "zona habitable", "zona muerta", "zona oscura"
        ],
        "Instrumentación y Astronomía Observacional": [
            "Aberración cromática", "aberración esférica", "aberración óptica", "abertura", "adaptativa", 
            "algoritmo de reconstrucción", "alineación", "altacimutal", "altitud", "amplificador", "ángulo de campo", 
            "ángulo de fase", "ángulo de posición", "antena", "antena parabólica", "apertura sintética", "apodización", 
            "área colectora", "artefacto", "asteroide", "astrofotografía", "astrolabio", "astrógrafo", "astrometría", 
            "atmósfera", "atmosférica", "atenuación", "auto-guía", "azimut", "banda", "banda ancha", "banda estrecha", 
            "banda infrarroja", "banda óptica", "banda radio", "banda ultravioleta", "banda X", "banco óptico", "base", 
            "base de datos", "baselength", "bolómetro", "brillo", "brillo aparente", "brillo de fondo", "brillo superficial", 
            "brillante", "calibración", "calibrador", "cámara", "cámara CCD", "cámara CMOS", "cámara infrarroja", 
            "cámara rápida", "cámara térmica", "cámara ultravioleta", "cámara X", "campo", "campo amplio", "campo profundo", 
            "campo ultra profundo", "campo visual", "campo magnético", "catadióptrico", "CCD", "centro", "centroide", 
            "círculo", "círculo de confusión", "círculo meridiano", "colimación", "colimador", "color", "colorimetría", 
            "coma", "contraste", "conversión", "convertidor", "coordenada", "coordenada ecuatorial", "coordenada galáctica", 
            "coordenada horizontal", "coordenadas", "coronógrafo", "corrector", "corrector de coma", "corrector de campo", 
            "criostato", "cristal", "cristal líquido", "cromatismo", "cronógrafo", "cronómetro", "cruz", "cúpula", "curva", 
            "curva de calibración", "curva de respuesta", "curva isofota", "definición", "densitómetro", "detector", 
            "detector de infrarrojos", "detector de microondas", "detector de neutrinos", "detector de ondas gravitacionales", 
            "detector de partículas", "detector de radiación", "detector de rayos cósmicos", "detector de rayos gamma", 
            "detector de rayos X", "detector óptico", "detector ultravioleta", "diagrama", "diagrama de fase", "diafragma", 
            "diámetro", "diámetro angular", "difracción", "difracción atmosférica", "difusor", "digitalización", 
            "digitalizador", "dimensión", "disco", "disco de Airy", "disco óptico", "distancia", "distancia focal", 
            "distancia angular", "distancia estelar", "distancia geométrica", "distancia instrumental", "distancia lunar", 
            "distancia métrica", "distancia modal", "distancia óptica", "distancia paralaje", "distancia fotométrica", 
            "distancia por corrimiento al rojo", "distorsión", "distorsión atmosférica", "distorsión cromática", 
            "distorsión geométrica", "distorsión óptica", "distribución", "divergencia", "divisor de haz", "domo", "eco", 
            "eco de radar", "eclipse", "eclíptica", "efemérides", "eje", "eje de declinación", "eje de rotación", 
            "eje óptico", "electrónica", "electroóptica", "elemento", "elemento dispersor", "elemento óptico", 
            "elemento sensor", "emisión", "emisión de radio", "emisión térmica", "emisión continua", "emisión de línea", 
            "emulsión", "emulsión fotográfica", "enfoque", "enfoque automático", "enfoque manual", "enmascaramiento", 
            "entorno", "envolvente", "error", "error instrumental", "error de apuntado", "error de arrastre", "error de cálculo", 
            "error de calibración", "error de centrado", "error de colimación", "error de coordenadas", "error de enfoque", 
            "error de guiado", "error de seguimiento", "error de sincronismo", "error de temperatura", "error periódico", 
            "error residual", "error sistemático", "error estándar", "error estadístico", "escala", "escala de ángulos", 
            "escala de colores", "escala de distancias", "escala de grises", "escala de imágenes", "escala de magnitudes", 
            "escala de temperaturas", "escala de tiempo", "escala logarítmica", "escala espacial", "escala temporal", 
            "espectro", "espectro de absorción", "espectro de emisión", "espectro continuo", "espectro de líneas", 
            "espectro visible", "espectro ultravioleta", "espectro infrarrojo", "espectro de radio", "espectro de rayos X", 
            "espectro de rayos gamma", "espectro estelar", "espectro molecular", "espectro atómico", "espectrofotómetro", 
            "espectrógrafo", "espectrómetro", "espectroscopia", "esfera", "esfera celeste", "esfera de integración", 
            "esfera de Riemann", "esfera de Hill", "esfera de Roche", "esfera de Dyson", "esfera óptica", "esférica", 
            "espejos", "espejos activos", "espejos adaptativos", "espejos bimetálicos", "espejos cóncavos", "espejos convexos", 
            "espejos de Berilio", "espejos de mercurio", "espejos de rayos X", "espejos dieléctricos", "espejos fijos", 
            "espejos gigantes", "espejos hiperbólicos", "espejos líquidos", "espejos múltiples", "espejos parabólicos", 
            "espejos planos", "espejos segmentados", "espejos térmicos", "estabilización", "estabilización de imagen", 
            "estación", "estación de observación", "estación espacial", "estación terrestre", "estación meteorológica", 
            "estación de seguimiento", "estación de radio", "estación de láser", "estación de calibración", "estación de control", 
            "estación de datos", "estación de energía", "estación de lanzamiento", "estrella", "estrella de referencia", 
            "estrella guía", "estrella estándar", "estrella variable", "estrella doble", "estrella múltiple", 
            "estrella estándar fotométrica", "estrella patrón", "estrella brillante", "estrella débil", "estrella cercana", 
            "estrella lejana", "estrella central", "estrella compañera", "estrella principal", "estrella secundaria", 
            "estrella fugaz", "estrella polar", "estructura", "estructura cristalina", "estructura de la galaxia", 
            "estructura de la materia", "estructura del universo", "estructura espiral", "estructura estelar", 
            "estructura fina", "estructura galáctica", "estructura granular", "estructura hiperfina", "estructura interna", 
            "estructura molecular", "estructura magnética", "estructura óptica", "estructura química", "sub-milimétrica", 
            "sub-miniatura", "sub-óptimo", "sub-píxel", "sub-sistema", "sub-superficie", "super-ancho", "super-campo", 
            "super-cúmulo", "super-resolución", "super-tierra", "super-velocidad", "super-vidrio", "super-voltaje", 
            "soporte", "soporte de espejo", "soporte de lente", "soporte de montaje", "soporte de antena", "soporte de cámara", 
            "soporte ecuatorial", "soporte de trípode", "soporte motorizado", "soporte altacimutal", "soporte de horquilla", 
            "soporte alemán", "soporte dobsoniano", "soporte de paralela", "sistema", "sistema activo", "sistema adaptativo", 
            "sistema astrométrico", "sistema automático", "sistema binario", "sistema catadióptrico", "sistema central", 
            "sistema cerrado", "sistema colector", "sistema computerizado", "sistema de adquisición", "sistema de alimentación", 
            "sistema de alarma", "sistema de análisis", "sistema de antena", "sistema de apuntado", "sistema de archivo", 
            "sistema de base", "sistema de calibración", "sistema de cámara", "sistema de captación", "sistema de carga", 
            "sistema de coordenadas", "sistema de control", "sistema de datos", "sistema de detección", "sistema de diagnóstico", 
            "sistema de dirección", "sistema de distribución", "sistema de enfoque", "sistema de energía", "sistema de enlace", 
            "sistema de espejos", "sistema de estrella guía", "sistema de filtros", "sistema de frenado", "sistema de guiado", 
            "sistema de imagen", "sistema de información", "sistema de infrarrojos", "sistema de instrumentación", 
            "sistema de integración", "sistema de interferometría", "sistema de lentes", "sistema de medición", 
            "sistema de monitoreo", "sistema de montaje", "sistema de navegación", "sistema de observación", "sistema de óptica", 
            "sistema de posicionamiento", "sistema de potencia", "sistema de procesamiento", "sistema de proyección", 
            "sistema de radar", "sistema de radio", "sistema de radioastronomía", "sistema de radiotelevisión", 
            "sistema de refrigeración", "sistema de reloj", "sistema de seguimiento", "sistema de señales", "sistema de sincronización", 
            "sistema de soporte", "sistema de telecomunicaciones", "sistema de telemetría", "sistema de telescopios", 
            "sistema de televisión", "sistema de temperatura", "sistema de tiempo", "sistema de transmisión", "sistema de vídeo", 
            "sistema de visión", "sistema de visualización", "sistema de voltajes", "sistema de rayos X", "sistema de rayos gamma", 
            "sistema de rayos cósmicos", "sistema de rayos ultravioleta", "sistema de rayos infrarrojos", 
            "sistema de posicionamiento global", "sistema de red", "sistema de servidores", "sistema de software", 
            "sistema de hardware"
        ],
        "Sistema Solar y Planetología": [
            "Ablación", "acretamiento", "actividad solar", "albedo", "análogo terrestre", "anillo planetario", 
            "anillo F", "anillo G", "anillo E", "anticiclón", "atmósfera", "atmósfera superior", "atmósfera inferior", 
            "aurora", "aurora boreal", "aurora austral", "aurora polar", "aurora de Júpiter", "aurora de Saturno", 
            "avenida de cometas", "banda de absorción", "banda de emission", "banda ecuatorial", "baricentro", "basalto", 
            "binaria", "bio-firma", "bolide", "brecha de Kirkwood", "brecha de Cassini", "brillo", "bulbo", "campo magnético", 
            "campo dipolar", "campo toroidal", "campo magnético planetario", "campo magnético solar", "campo magnético terrestre", 
            "captura gravitacional", "capa de ozono", "capa de hielo", "capa convectiva", "capa radiactiva", "capa de transición", 
            "capa límite", "cráter", "cráter de impacto", "cráter volcánico", "cráter de colapso", "cráter de explosión", 
            "cráter complejo", "cráter simple", "cráter multianillo", "cráter central", "crepúsculo", "crepúsculo astronómico", 
            "crepúsculo náutico", "crepúsculo civil", "criovolcanismo", "ciclo de manchas solares", "ciclo solar", "ciclón", 
            "ciclón tropical", "ciclón extratropical", "ciclón joviano", "ciclón marciano", "ciclón venusino", 
            "ciclón saturniano", "ciclón neptuniano", "ciclón uraniano", "ciclón polar", "ciclón magnético", 
            "cinturón de asteroides", "cinturón de Kuiper", "cinturón de radiación", "cinturón de Van Allen", 
            "cinturón de polvo", "cinturón de partículas", "circulación atmosférica", "circulación global", 
            "circulación meridional", "circulación zonal", "circulación de Hadley", "circulación de Walker", 
            "circulación de Ferrel", "circulación polar", "composición", "composición atmosférica", "composición química", 
            "composición mineralógica", "composición isotópica", "composición elemental", "composición geológica", 
            "composición del hielo", "composición del polvo", "composición del gas", "composición del plasma", 
            "composición del magma", "composición del núcleo", "composición del manto", "composición de la corteza", 
            "cometa", "cometa activo", "cometa inactivo", "cometa periódico", "cometa no periódico", "cometa de periodo corto", 
            "cometa de periodo largo", "cometa rasante", "cometa extinto", "cometa durmiente", "cometa fragmentado", 
            "cometa gigante", "cometa binario", "cometa con cola", "cometa sin cola", "cometa de gas", "cometa de polvo", 
            "cometa verde", "cometa azul", "cometa brillante", "cometa débil", "condensación", "conductividad", 
            "conductividad eléctrica", "conductividad térmica", "conductividad magnética", "cono", "cono de sombra", 
            "cono de eyección", "cono de impacto", "cono volcánico", "cono de radiación", "cono de viento", "cono de luz", 
            "cono geométrica", "cono convectiva", "convección", "convección térmica", "convección forzada", 
            "convección natural", "convección turbulenta", "convección laminar", "convección magnética", "convección atmosférica", 
            "convección oceánica", "convección del manto", "convección del núcleo", "convección del sol", "convección estelar", 
            "convección planetaria", "convección global", "convección local", "convección en espiral", "convección en celdas", 
            "convección en rings", "convección en penachos", "convección en chorros", "convección en ondas", "convección en vórtices", 
            "convección en plumas", "convección en filamentos", "convergencia", "convergencia atmosférica", "convergencia oceánica", 
            "convergencia magnética", "convergencia de vientos", "convergencia de corrientes", "convergencia de ondas", 
            "convergencia de partículas", "convergencia de trayectorias", "convergencia de imágenes", "convergencia geométrica", 
            "convergencia óptica", "convergencia estelar", "convergencia planetaria", "convergencia gravitacional", 
            "convergencia electrónica", "convergencia digital", "convergencia de datos"
        ],
        "Astrobiología y Exoplanetas": [
            "Abiogénesis", "actinobacteria", "adaptación", "aeroplaneta", "algas", "aminoácido", "amoníaco", 
            "anaerobio", "análisis espectral", "análogo terrestre", "análogo marciano", "anticiclón", "arqueas", 
            "astrobiología", "astrofísica", "atmósfera", "atmósfera primitiva", "atmósfera secundaria", "atmósfera oxidante", 
            "atmósfera reductora", "atmósfera estelar", "atmósfera planetaria", "atmósfera exoplanetaria", "atmósfera terrestre", 
            "atmósfera marciana", "atmósfera venusina", "atmósfera joviana", "atmósfera de titán", "atmósfera de encélado", 
            "atmósfera de europa", "atmósfera de tritón", "atmósfera de plutón", "atmósfera de caronte", "atmósfera de ceres", 
            "atmósfera de vesta", "atmósfera de pallas", "atmósfera de hygiea", "atmósfera de eris", "atmósfera de makemake", 
            "atmósfera de haumea", "atmósfera de sedna", "atmósfera de orcus", "atmósfera de quaoar", "atmósfera de varuna", 
            "atmósfera de ixion", "atmósfera de huya", "atmósfera de chaos", "atmósfera de deucalion", "atmósfera de rhadamanthus", 
            "atmósfera de ceto", "atmósfera de echidna", "atmósfera de typhon", "atmósfera de proserpina", "atmósfera de persephone", 
            "atmósfera de cerberus", "atmósfera de erebus", "atmósfera de charon", "atmósfera de hydra", "atmósfera de nix", 
            "atmósfera de kerberos", "atmósfera de styx", "atmósfera de arrokoth", "atmósfera de ultima thule", 
            "atmósfera de gwacwolo", "atmósfera de kamo'oalewa", "atmósfera de cruithne", "atmósfera de yorp", 
            "atmósfera de asteroides", "atmósfera de cometas", "atmósfera de meteoros", "atmósfera de polvo", "atmósfera de gas", 
            "atmósfera de plasma", "atmósfera de iones", "atmósfera de electrones", "atmósfera de protones", "atmósfera de neutrones", 
            "atmósfera de neutrinos", "atmósfera de fotones", "atmósfera de rayos cósmicos", "atmósfera de rayos gamma", 
            "atmósfera de rayos X", "atmósfera de rayos ultravioleta", "atmósfera de rayos infrarrojos", "atmósfera de microondas", 
            "atmósfera de ondas de radio", "atmósfera de ondas gravitacionales", "atmósfera de materia oscura", "atmósfera de energía oscura"
        ],
        "Astronomía de Posición y Esfera Celeste": [
            "Aberración", "acimut", "acronical", "almicantarat", "analema", "ángulo horario", "anomalía", "ápex", 
            "apogeo", "apside", "ascension", "asterismo", "astrolabio", "azimut", "banda", "bisección", "bóveda", "brillo", 
            "cálculo", "calendario", "cenit", "ciclo", "circumpolar", "coluro", "cometa", "conjunción", "constelación", 
            "coordenadas", "crepúsculo", "cuadrante", "culminación", "declinación", "deferente", "diámetro", "disco", 
            "efemérides", "elipse", "elíptica", "elongación", "epiciclo", "época", "equinoccio", "era", "esfera", "estrella", 
            "fase", "fulgor", "galaxia", "geocéntrico", "gnomon", "gravedad", "grado", "heliocéntrico", "hemisferio", 
            "horizonte", "hora", "inclinación", "índice", "interferencia", "latitud", "longitud", "luna", "lunación", 
            "magnitud", "mapa", "marea", "mecánica", "meridiano", "meteoro", "minuto", "movimiento", "nadir", "nodo", 
            "nutación", "oblicuidad", "ocultación", "órbita", "paralaje", "perigeo", "perihelio", "periodo", "perturbación", 
            "planetas", "polo", "precesión", "quadrante", "radio", "refracción", "retrogradación", "revolución", "satélite", 
            "segundo", "semidiámetro", "solsticio", "tiempo", "tránsito", "trópico", "universo", "vector", "velocidad", 
            "vértice", "zenith", "zodíaco"
        ],
        "Radioastronomía y Nuevas Tecnologías": [
            "Abrechnung", "absorción", "accrete", "acoplador", "acoplamiento", "activación", "activo", 
            "adaptación", "adonde", "aerosol", "afinar", "agujero", "ajuste", "alcance", "alerta", "algoritmo", 
            "alineación", "altavoz", "aluminio", "ambiente", "ambulancia", "amplitud", "análisis", "análogo", 
            "anclaje", "ángulo", "anillas", "anomalía", "antena", "apertura", "apogeo", "aplication", "archivo", 
            "área", "armónico", "arreglo", "arte", "artículo", "asequible", "asepsia", "asesor", "asimetría", 
            "asignación", "asistencia", "asociado", "asteroide", "astro", "astrofísica", "astrometría", "astrofotografía", 
            "atmósfera", "átomo", "atractor", "atributo", "audiencia", "auricular", "automático", "automatización", 
            "avance", "avería", "azimut", "banda", "banco", "base", "batería", "binaria", "bio", "bit", "bobina", 
            "bolómetro", "borde", "borne", "bosquejo", "brazo", "brillante", "brillo", "bulbo", "byte", "cable", 
            "cadena", "caída", "caja", "cálculo", "calibración", "calibre", "calor", "cámara", "cambio", "camino", 
            "campo", "canal", "capacidad", "capacitor", "cápsula", "característica", "carga", "carta", "catadióptrico", 
            "catastro", "categoría", "catenario", "catión", "catorce", "catus", "causa", "cavidad", "ccd", "celda", 
            "celestial", "célula", "central", "centro", "centroide", "cerámica", "cérvido", "cesio", "ciclo", "ciclón", 
            "ciencia", "científico", "círculo", "circuito", "circulación", "circunvalación", "cisco", "citrato", 
            "ciudad", "civil", "clave", "clepsidra", "clima", "clínica", "clip", "clúster", "cmos", "coaxial", "cobalto", 
            "cobre", "código", "coeficiente", "colector", "colimador", "color", "columna", "comando", "comercio", 
            "compacto", "compañía", "comparable", "comparador", "compartimiento", "compás", "compensación", "competencia", 
            "compilador", "componente", "comportamiento", "composición", "compresor", "computadora", "comunicación", 
            "comunidad", "concentración", "concepto", "concordancia", "condensador", "condición", "conducción", 
            "conductividad", "conector", "conexión", "cono", "conservación", "consideración", "consistencia", 
            "consola", "constante", "construcción", "consulta", "contacto", "contador", "contenedor", "contenido", 
            "contexto", "continuo", "contraste", "control", "convergencia", "conversión", "convertidor", "coordenada", 
            "copia", "cordillera", "corona", "corrección", "corrector", "correlación", "correspondencia", "corriente", 
            "corte", "corteza", "cosmología", "cosmos", "costa", "cráter", "creación", "crepúsculo", "criterio", 
            "crítica", "cronógrafo", "cronología", "cruce", "crupier", "cuatro", "cubículo", "cuenta", "cuerdas", 
            "cuerpo", "cueva", "cultivador", "cultivo", "cúmulo", "cuociente", "cúpula", "cura", "curación", 
            "curador", "curva", "custodio", "custom", "cyber"
        ]
    }

    def normalize(text):
        text = text.lower()
        text = re.sub(r'[áàäâ]', 'a', text)
        text = re.sub(r'[éèëê]', 'e', text)
        text = re.sub(r'[íìïî]', 'i', text)
        text = re.sub(r'[óòöô]', 'o', text)
        text = re.sub(r'[úùüû]', 'u', text)
        text = re.sub(r'[^a-z0-9\s]', '', text)
        return text

    kw_to_group = {}
    for group, keywords in keywords_list.items():
        for kw in keywords:
            kw_norm = normalize(kw)
            if len(kw_norm) > 3:
                if kw_norm not in kw_to_group:
                    kw_to_group[kw_norm] = []
                kw_to_group[kw_norm].append(group)

    db_file = "fetched_queries_db.json"
    results_db = {}
    if os.path.exists(db_file):
        try:
            with open(db_file, "r", encoding="utf-8") as f_db:
                results_db = json.load(f_db)
            print(f"Loaded {len(results_db)} queries from cache.")
        except Exception as e:
            print("Error loading cache:", e)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://cb.awebaos.org/",
        "Accept": "application/json"
    }

    print("Fetching queries from cb.awebaos.org API...")
    success_count = 0
    for idx, q in enumerate(queries_list):
        uuid = q["uuid"]
        url = f"https://cb.awebaos.org/api/savedquery/{uuid}"
        
        success = False
        # Fetch latest references (force refresh to capture new episodes for existing queries)
        for attempt in range(1, 4):
            try:
                r = requests.get(url, headers=headers, timeout=35)
                if r.status_code == 200:
                    results_db[uuid] = r.json()
                    success = True
                    success_count += 1
                    print(f"[{idx+1}/{len(queries_list)}] Successfully fetched {uuid} - Query: \"{q['query']}\"")
                    break
                else:
                    print(f"[{idx+1}/{len(queries_list)}] Attempt {attempt} for {uuid} returned status {r.status_code}")
            except Exception as e:
                print(f"[{idx+1}/{len(queries_list)}] Attempt {attempt} for {uuid} failed: {e}")
            time.sleep(1.5)
            
        if not success:
            print(f"Warning: Failed to fetch uuid: {uuid}. Keeping old cached data if available.")
            
        # Rate-limiting politeness
        time.sleep(0.5)

    # Save fetched db cache
    with open(db_file, "w", encoding="utf-8") as f_db:
        json.dump(results_db, f_db, indent=2, ensure_ascii=False)
    print(f"Cache saved. Total records: {len(results_db)}")

    # Extract and classify fragments
    fragments_by_group = {group: [] for group in keywords_list.keys()}
    seen_fragments = set()

    for uuid, q_data in results_db.items():
        query_text = q_data.get("query", "")
        query_norm = normalize(query_text)
        
        matched_groups = set()
        for kw_norm, groups in kw_to_group.items():
            if re.search(r'\b' + re.escape(kw_norm) + r'\b', query_norm):
                for g in groups:
                    matched_groups.add(g)
                    
        if not matched_groups:
            continue
            
        references = q_data.get("references", [])
        for ref in references:
            file_name = ref.get("file", "")
            time_sec = ref.get("time", 0)
            speaker = ref.get("tag", "")
            label_es = ref.get("label", {}).get("es", "")
            label_en = ref.get("label", {}).get("en", "")
            hyperlink_es = ref.get("hyperlink", {}).get("es", "")
            hyperlink_en = ref.get("hyperlink", {}).get("en", "")
            
            if not file_name or not speaker:
                continue
                
            fragment = {
                "file": file_name,
                "time": time_sec,
                "speaker": speaker,
                "label_es": label_es,
                "label_en": label_en,
                "hyperlink_es": hyperlink_es,
                "hyperlink_en": hyperlink_en,
                "source_query": query_text
            }
            
            for g in matched_groups:
                group_key = (g, file_name, time_sec, speaker)
                if group_key not in seen_fragments:
                    seen_fragments.add(group_key)
                    fragments_by_group[g].append(fragment)

    total_fragments = 0
    for g, frags in fragments_by_group.items():
        print(f"Group: {g} - Fragments: {len(frags)}")
        total_fragments += len(frags)
    print(f"Total classified fragments: {total_fragments}")

    output_data = {
        "groups": fragments_by_group,
        "last_updated": time.strftime("%Y-%m-%d %H:%M:%S")
    }

    with open("fragments_data.json", "w", encoding="utf-8") as f_out:
        json.dump(output_data, f_out, indent=2, ensure_ascii=False)
    print("Saved final grouped fragments data to fragments_data.json")

if __name__ == "__main__":
    main()
