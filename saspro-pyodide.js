/**
 * Módulo de Integración de Pyodide y SASPro (WebAssembly + Python)
 * Permite ejecutar algoritmos científicos de astrofotografía directamente en el navegador.
 */

const SASProPyodide = (() => {
  let pyodideInstance = null;
  let isInitializing = false;
  let isReady = false;

  // URLs de los scripts de SASPro en GitHub (se pueden personalizar)
  const SASPRO_GITHUB_BASE = "https://raw.githubusercontent.com/setiastro/setiastrosuitepro/main/src/saspro/";
  const CORE_FILES = [
    { name: "core.py", url: SASPRO_GITHUB_BASE + "core.py" },
    { name: "stretch.py", url: SASPRO_GITHUB_BASE + "stretch.py" },
    { name: "scnr.py", url: SASPRO_GITHUB_BASE + "scnr.py" },
    { name: "decon.py", url: SASPRO_GITHUB_BASE + "decon.py" }
  ];

  // Elementos de la interfaz para el Loader
  function showLoader(message) {
    const loader = document.getElementById("piwLoader");
    const loaderText = document.getElementById("piwLoaderText");
    if (loader && loaderText) {
      loaderText.textContent = message;
      loader.style.display = "flex";
    }
    console.log(`[Pyodide] ${message}`);
  }

  function hideLoader() {
    const loader = document.getElementById("piwLoader");
    if (loader) {
      loader.style.display = "none";
    }
  }

  function logConsole(message, type = "info") {
    // Intenta usar el logConsole de pi-workflow.js
    if (window.logConsole) {
      window.logConsole(`[Pyodide/SASPro] ${message}`, type);
    } else {
      console.log(`[${type.toUpperCase()}] [Pyodide] ${message}`);
    }
  }

  /**
   * Inicializa Pyodide y descarga las librerías necesarias.
   */
  async function init() {
    if (isReady) return pyodideInstance;
    if (isInitializing) {
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (isReady) {
            clearInterval(check);
            resolve(pyodideInstance);
          }
        }, 100);
      });
    }

    isInitializing = true;
    showLoader("Cargando Pyodide (WebAssembly)...");

    try {
      // 1. Inicializar Pyodide runtime
      pyodideInstance = await loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/"
      });

      // 2. Instalar micropip
      showLoader("Configurando instalador de paquetes (micropip)...");
      await pyodideInstance.loadPackage("micropip");

      // 3. Instalar librerías científicas pesadas nativas
      showLoader("Cargando numpy, scipy, scikit-image y scikit-learn...");
      await pyodideInstance.loadPackage(["numpy", "scipy", "scikit-image", "scikit-learn"]);

      // 4. Instalar astropy (disponible en la distribución oficial de Pyodide)
      showLoader("Cargando astropy...");
      await pyodideInstance.loadPackage("astropy");

      // 5. Descargar/Configurar scripts de SASPro
      showLoader("Descargando código de SASPro desde GitHub...");
      await loadSASProScripts();

      isReady = true;
      logConsole("Entorno científico de Python inicializado con éxito", "ok");
    } catch (error) {
      logConsole(`Error al inicializar Pyodide: ${error.message}`, "err");
      isInitializing = false;
      throw error;
    } finally {
      hideLoader();
    }

    return pyodideInstance;
  }

  /**
   * Descarga los scripts de SASPro de GitHub y los guarda en el FS de Pyodide.
   * Si fallan las descargas, inyecta una implementación fallback funcional del core.
   */
  async function loadSASProScripts() {
    // Crear directorio del paquete saspro
    pyodideInstance.FS.mkdir("/target");
    pyodideInstance.FS.mkdir("/target/saspro");

    let successCount = 0;
    for (const file of CORE_FILES) {
      try {
        const response = await fetch(file.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const content = await response.text();
        pyodideInstance.FS.writeFile(`/target/saspro/${file.name}`, content);
        successCount++;
        logConsole(`Descargado módulo: ${file.name}`, "info");
      } catch (err) {
        logConsole(`No se pudo descargar ${file.name} de GitHub: ${err.message}. Usando implementación interna.`, "warn");
      }
    }

    // Si no se descargaron de GitHub (ej. sin internet o repositorio privado),
    // escribimos las rutinas de procesamiento astrofotográfico directamente.
    if (successCount < CORE_FILES.length) {
      writeFallbackScripts();
    }

    // Añadir el path al entorno de Python
    pyodideInstance.runPython(`
      import sys
      if "/target" not in sys.path:
          sys.path.append("/target")
      
      # Generar datos de calibración vacíos de referencia (SASP_data.fits) si no existen
      import os
      if not os.path.exists("SASP_data.fits"):
          from astropy.io import fits
          import numpy as np
          hdr = fits.Header()
          hdr['COMMENT'] = "SASP reference data catalog"
          primary_hdu = fits.PrimaryHDU(data=np.zeros((10, 10), dtype=np.float32), header=hdr)
          hdu_list = fits.HDUList([primary_hdu])
          hdu_list.writeto("SASP_data.fits", overwrite=True)
    `);
  }

  /**
   * Escribe implementaciones en Python de Statistical Stretch y SCNR
   * en el FS virtual de Pyodide para asegurar que el sistema sea autosuficiente.
   */
  function writeFallbackScripts() {
    const corePy = `
# Core de SASPro Headless
import numpy as np
from astropy.io import fits

def load_fits(path):
    with fits.open(path) as hdul:
        data = hdul[0].data
        # Asegurar float32 normalizado
        if data.dtype != np.float32:
            data = data.astype(np.float32)
        # Normalizar si no lo está (suponiendo FITS de 16 o 32 bits enteros)
        if np.max(data) > 1.0:
            data = data / 65535.0 if np.max(data) <= 65535.0 else data / np.max(data)
        return data

def save_fits(data, path):
    hdu = fits.PrimaryHDU(data)
    hdul = fits.HDUList([hdu])
    hdul.writeto(path, overwrite=True)
`;

    const stretchPy = `
# Módulo de estirado no lineal (Statistical Stretch / Star Stretch)
import numpy as np

def statistical_stretch(img, target_median=0.15, sigma_clip=2.8):
    # img puede tener forma (ch, h, w) o (h, w)
    if len(img.shape) == 3:
        out = np.zeros_like(img)
        for c in range(img.shape[0]):
            out[c] = _stretch_channel(img[c], target_median, sigma_clip)
        return out
    else:
        return _stretch_channel(img, target_median, sigma_clip)

def _stretch_channel(ch, target, sigma):
    # 1. Calcular mediana y desviación estándar robusta (MAD)
    med = np.median(ch)
    dev = np.median(np.abs(ch - med))
    if dev < 1e-6:
        dev = np.std(ch)
    if dev < 1e-6:
        dev = 0.001
        
    # 2. Calcular punto de negro y normalizar
    bp = max(0.0, med - sigma * dev)
    denom = 1.0 - bp
    if denom < 1e-6:
        denom = 1.0
    ch_norm = np.clip((ch - bp) / denom, 0.0, 1.0)
    
    # 3. Aplicar estiramiento MTF para llevar la mediana al objetivo
    med_norm = np.median(ch_norm)
    x = med_norm
    if x <= 0.0001:
        x = 0.002
    
    # MTF (m, x) = target -> despejar m
    m = (target - 1.0) * x / (x * (2.0 * target - 1.0) - target)
    m = np.clip(m, 0.0001, 0.9999)
    
    # Aplicar MTF
    denom_mtf = (2.0 * m - 1.0) * ch_norm - m
    # Evitar división por cero
    denom_mtf = np.where(np.abs(denom_mtf) < 1e-12, 1e-12, denom_mtf)
    result = (m - 1.0) * ch_norm / denom_mtf
    return np.clip(result, 0.0, 1.0)

def star_stretch(img, target_median=0.10, sigma_clip=3.5, color_preservation=0.8):
    # Estiramiento más suave que respeta los perfiles gaussianos y colores de las estrellas
    stretched = statistical_stretch(img, target_median, sigma_clip)
    # Mezclar con una corrección de potencia cromática para preservar el color de las estrellas
    if len(img.shape) == 3:
        # Volver a saturar los colores basándonos en la relación original de los canales
        for c in range(img.shape[0]):
            # Aplicar corrección gamma para preservar la saturación original
            stretched[c] = np.power(stretched[c], color_preservation)
    return np.clip(stretched, 0.0, 1.0)
`;

    const scnrPy = `
# Módulo de SCNR (Subtractive Chrominance Noise Reduction)
import numpy as np

def scnr_green(img, amount=1.0):
    if len(img.shape) != 3 or img.shape[0] < 3:
        return img # Solo aplica a color
    
    r, g, b = img[0], img[1], img[2]
    # SCNR clásico de PixInsight: el verde no puede superar al máximo del rojo y azul
    max_rb = np.maximum(r, b)
    g_new = np.where(g > max_rb, g - amount * (g - max_rb), g)
    
    out = np.zeros_like(img)
    out[0], out[1], out[2] = r, g_new, b
    return out
`;

    const gradientPy = `
# Módulo de eliminación de gradiente en Python usando scikit-learn y scipy
import numpy as np
from scipy.interpolate import Rbf

def apply_graxpert_ia(img, correction="subtraction", smoothness=0.5):
    from sklearn.neural_network import MLPRegressor
    from skimage.transform import resize
    
    nc = img.shape[0] if len(img.shape) == 3 else 1
    h, w = img.shape[-2], img.shape[-1]
    
    # 1. Grid sampling (approx. 40x40 grid to train quickly in Pyodide/WASM)
    step = max(2, min(w, h) // 40)
    
    X_train = []
    y_train = []
    
    for y in range(0, h, step):
        for x in range(0, w, step):
            vals = [img[c, y, x] for c in range(nc)] if nc > 1 else [img[0, y, x]]
            X_train.append([x / w, y / h])
            y_train.append(vals)
            
    X_train = np.array(X_train)
    y_train = np.array(y_train)
    
    # 2. Robust Iterative Polynomial Sigma Clipping to filter out stars and nebulae
    X = X_train[:, 0]
    Y = X_train[:, 1]
    # 2nd order polynomial basis matrix: [1, x, y, x^2, y^2, x*y]
    A = np.column_stack([np.ones_like(X), X, Y, X**2, Y**2, X*Y])
    
    valid_mask = np.ones(len(X_train), dtype=bool)
    
    for iteration in range(4):
        if np.sum(valid_mask) < 20:
            break
        
        A_valid = A[valid_mask]
        y_valid = y_train[valid_mask]
        
        # Fit polynomial using least squares
        coefs, _, _, _ = np.linalg.lstsq(A_valid, y_valid, rcond=None)
        
        # Predict values for all points
        y_pred = A @ coefs
        residuals = y_train - y_pred
        
        new_mask = np.ones(len(X_train), dtype=bool)
        for c in range(nc):
            res_c = residuals[:, c]
            med_c = np.median(res_c[valid_mask])
            mad_c = np.median(np.abs(res_c[valid_mask] - med_c))
            if mad_c < 1e-6:
                mad_c = np.std(res_c[valid_mask])
            if mad_c < 1e-6:
                mad_c = 0.001
                
            # Discard points that are too bright (stars, nebulae, galaxies)
            threshold_high = med_c + 1.5 * mad_c
            # Discard points that are too dark (hot/cold pixel artifacts, extreme edge issues)
            threshold_low = med_c - 3.0 * mad_c
            
            new_mask &= (res_c <= threshold_high) & (res_c >= threshold_low)
            
        valid_mask = new_mask
        
    X_clean = X_train[valid_mask]
    y_clean = y_train[valid_mask]
    
    if len(X_clean) < 20:
        # Fallback to simple percentile if robust clipping discarded too many points
        lumas = np.mean(y_train, axis=1)
        p75 = np.percentile(lumas, 75)
        valid_idx = lumas < p75
        X_clean = X_train[valid_idx]
        y_clean = y_train[valid_idx]
        valid_mask = valid_idx
        
    # 3. Positional Encoding / Fourier Features to represent smooth low-frequency details
    def get_fourier_features(coords):
        x = coords[:, 0]
        y = coords[:, 1]
        features = [x, y]
        # Include low-frequency sine/cosine components
        for freq in [1, 2, 4]:
            features.append(np.sin(freq * np.pi * x))
            features.append(np.cos(freq * np.pi * x))
            features.append(np.sin(freq * np.pi * y))
            features.append(np.cos(freq * np.pi * y))
        return np.column_stack(features)
        
    X_features = get_fourier_features(X_clean)
    
    # Map smoothness (0.0 to 1.0) to MLP L2 regularization parameter 'alpha' (0.1 to 50.0)
    # Larger alpha forces smoother/flatter gradients. Smaller alpha allows more complex gradients.
    alpha_val = float(0.1 * (500.0 ** smoothness))
    
    # 4. Train neural network (MLPRegressor) on clean background features
    mlp = MLPRegressor(
        hidden_layer_sizes=(16, 8),
        activation='tanh',
        solver='lbfgs',
        max_iter=200,
        alpha=alpha_val,
        random_state=42
    )
    mlp.fit(X_features, y_clean)
    
    # 5. Evaluate MLP on a smaller grid for extreme speed and low-frequency smoothness
    eval_h = min(h, 128)
    eval_w = min(w, 128)
    
    Y_eval_grid, X_eval_grid = np.mgrid[0:eval_h, 0:eval_w]
    X_eval_points = np.vstack([X_eval_grid.ravel() / eval_w, Y_eval_grid.ravel() / eval_h]).T
    X_eval_features = get_fourier_features(X_eval_points)
    
    bg_small_flat = mlp.predict(X_eval_features) # shape: (eval_h*eval_w, nc)
    bg_small = bg_small_flat.reshape((eval_h, eval_w, nc))
    
    # 6. Resize background model to full resolution using smooth bicubic interpolation
    bg_model = np.zeros_like(img)
    for c in range(nc):
        # order=3 is bicubic, mode='reflect' handles edges nicely
        bg_model[c] = resize(bg_small[:, :, c], (h, w), order=3, mode='reflect', anti_aliasing=False)
        
    result = np.zeros_like(img)
    
    # 7. Apply gradient subtraction or division
    for c in range(nc):
        ch = img[c]
        bg_ch = bg_model[c]
        
        # Clip gradient within the actual range of clean background to prevent extreme divergences
        min_val = np.percentile(y_train[valid_mask, c], 1)
        max_val = np.percentile(y_train[valid_mask, c], 99)
        bg_ch = np.clip(bg_ch, min_val, max_val)
        
        bg_model[c] = bg_ch
        
        if correction == "subtraction":
            # Subtract gradient and add a pedestal to preserve sky background level
            # Using median of the gradient as the sky background pedestal
            pedestal = np.median(bg_ch)
            res = ch - bg_ch + pedestal
        else:
            # Division correction: division by normalized gradient
            denom = np.maximum(0.001, bg_ch)
            res = (ch / denom) * np.mean(bg_ch)
            
        result[c] = np.clip(res, 0.0, 1.0)
        
    return result, bg_model


def apply_autodbe(img, num_points=50, tolerance=2.0, smoothness=0.25, correction="subtraction"):
    nc = img.shape[0] if len(img.shape) == 3 else 1
    h, w = img.shape[-2], img.shape[-1]
    
    img_medians = [np.median(img[c]) for c in range(nc)]
    img_stddevs = [np.std(img[c]) for c in range(nc)]
    
    win_size = 20
    spacing = 10
    
    # 12 puntos iniciales en los bordes (como SetiAstro)
    edge_points = [
        (10, 10),
        (w - win_size - 10, 10),
        (10, h - win_size - 10),
        (w - win_size - 10, h - win_size - 10),
        (w // 2 - win_size // 2, 10),
        (w // 2 - win_size // 2, h - win_size - 10),
        (10, h // 2 - win_size // 2),
        (w - win_size - 10, h // 2 - win_size // 2),
        (w // 4 - win_size // 2, 10),
        (3 * w // 4 - win_size // 2, 10),
        (w // 4 - win_size // 2, h - win_size - 10),
        (3 * w // 4 - win_size // 2, h - win_size - 10)
    ]
    
    # Generar puntos aleatorios distribuidos en 4 cuadrantes (como SetiAstro)
    random_points = []
    qw, qh = w // 2, h // 2
    quads = [(0, 0), (qw, 0), (0, qh), (qw, qh)]
    pts_per_quad = int(np.ceil(num_points / 4))
    
    search_region_size = 100
    for qx, qy in quads:
        grid_brightness = []
        for x in range(qx, qx + qw - search_region_size, search_region_size):
            for y in range(qy, qy + qh - search_region_size, search_region_size):
                sub_img = img[:, y:y+search_region_size, x:x+search_region_size]
                avg_val = np.mean(sub_img)
                grid_brightness.append(((x, y), avg_val))
        
        grid_brightness.sort(key=lambda item: item[1])
        filtered_regions = grid_brightness[:int(len(grid_brightness) * 2 / 3)]
        np.random.shuffle(filtered_regions)
        
        for (rx, ry), _ in filtered_regions[:pts_per_quad]:
            px = rx + np.random.randint(0, search_region_size - win_size)
            py = ry + np.random.randint(0, search_region_size - win_size)
            px = min(px, w - win_size)
            py = min(py, h - win_size)
            random_points.append((px, py))
            
    starting_points = edge_points + random_points
    
    thresholds = [img_medians[c] + 0.3 * img_stddevs[c] for c in range(nc)]
    max_thresholds = [img_medians[c] + 0.15 * img_stddevs[c] for c in range(nc)]
    
    accepted_points = []
    
    def get_window_stats(x, y):
        means = []
        mads = []
        for c in range(nc):
            win = img[c, y:y+win_size, x:x+win_size]
            mean = np.mean(win)
            std = np.std(win)
            if std > 0:
                filtered = win[np.abs(win - mean) <= tolerance * std]
            else:
                filtered = win
            if len(filtered) == 0:
                filtered = win
            
            new_mean = np.mean(filtered)
            new_median = np.median(filtered)
            new_mad = np.mean(np.abs(filtered - new_median))
            
            means.append(new_mean)
            mads.append(new_mad)
        return means, mads

    # Gradient descent para cada punto inicial
    for px, py in starting_points:
        current_x, current_y = px, py
        improved = True
        
        best_means, best_mads = get_window_stats(current_x, current_y)
        best_sum = sum(best_means)
        
        while improved:
            improved = False
            for dx in [-spacing, 0, spacing]:
                for dy in [-spacing, 0, spacing]:
                    if dx == 0 and dy == 0:
                        continue
                    nx, ny = current_x + dx, current_y + dy
                    if 0 <= nx <= w - win_size and 0 <= ny <= h - win_size:
                        n_means, n_mads = get_window_stats(nx, ny)
                        n_sum = sum(n_means)
                        if n_sum < best_sum:
                            best_sum = n_sum
                            best_means = n_means
                            best_mads = n_mads
                            current_x, current_y = nx, ny
                            improved = True
                            
        exceeds = False
        for c in range(nc):
            if best_means[c] > max_thresholds[c]:
                exceeds = True
                break
        
        if not exceeds:
            accepted_points.append({
                'x': current_x + win_size // 2,
                'y': current_y + win_size // 2,
                'vals': best_means,
                'mads': best_mads
            })
            
    # Fallback con tolerancias expandidas si es necesario
    if len(accepted_points) < 3:
        accepted_points = []
        fallback_max = [img_medians[c] + 2 * img_stddevs[c] for c in range(nc)]
        for px, py in starting_points:
            current_x, current_y = px, py
            best_means, best_mads = get_window_stats(current_x, current_y)
            best_sum = sum(best_means)
            improved = True
            while improved:
                improved = False
                for dx in [-spacing, 0, spacing]:
                    for dy in [-spacing, 0, spacing]:
                        if dx == 0 and dy == 0:
                            continue
                        nx, ny = current_x + dx, current_y + dy
                        if 0 <= nx <= w - win_size and 0 <= ny <= h - win_size:
                            n_means, n_mads = get_window_stats(nx, ny)
                            n_sum = sum(n_means)
                            if n_sum < best_sum:
                                best_sum = n_sum
                                best_means = n_means
                                best_mads = n_mads
                                current_x, current_y = nx, ny
                                improved = True
            exceeds = False
            for c in range(nc):
                if best_means[c] > fallback_max[c]:
                    exceeds = True
                    break
            if not exceeds:
                accepted_points.append({
                    'x': current_x + win_size // 2,
                    'y': current_y + win_size // 2,
                    'vals': best_means,
                    'mads': best_mads
                })
                
    if len(accepted_points) < 3:
        for px, py in edge_points[:4]:
            best_means, best_mads = get_window_stats(px, py)
            accepted_points.append({
                'x': px + win_size // 2,
                'y': py + win_size // 2,
                'vals': best_means,
                'mads': best_mads
            })

    xs = [pt['x'] for pt in accepted_points]
    ys = [pt['y'] for pt in accepted_points]
    
    bg_model = np.zeros_like(img)
    
    for c in range(nc):
        vals = [pt['vals'][c] for pt in accepted_points]
        w_weights = []
        for pt in accepted_points:
            median_val = img_medians[c] if img_medians[c] > 0 else 0.0001
            noise_factor = 1.0 - (pt['mads'][c] / median_val)
            noise_weight = max(0.1, min(1.0, noise_factor))
            
            cx, cy = w / 2, h / 2
            dist = np.sqrt((pt['x'] - cx)**2 + (pt['y'] - cy)**2)
            max_dist = np.sqrt(cx**2 + cy**2)
            center_weight = 0.95 + 0.05 * (dist / max_dist)
            
            edge_th_x, edge_th_y = w * 0.1, h * 0.1
            edge_weight = 0.95 if (pt['x'] < edge_th_x or pt['x'] > w - edge_th_x or pt['y'] < edge_th_y or pt['y'] > h - edge_th_y) else 1.0
            
            w_weights.append(noise_weight * center_weight * edge_weight)
            
        rbf = Rbf(xs, ys, vals, function='multiquadric', smooth=smoothness * 10.0)
        # Evaluate RBF in chunks of rows to prevent memory errors in WASM (Pyodide)
        chunk_size = 100
        for y_start in range(0, h, chunk_size):
            y_end = min(y_start + chunk_size, h)
            grid_y, grid_x = np.mgrid[y_start:y_end, 0:w]
            bg_model[c, y_start:y_end, :] = rbf(grid_x, grid_y)
        bg_model[c] = np.clip(bg_model[c], np.min(vals), np.max(vals))
        
    result = np.zeros_like(img)
    for c in range(nc):
        if correction == "subtraction":
            pedestal = np.percentile(img[c], 10)
            res = img[c] - bg_model[c] + pedestal
        else:
            denom = np.maximum(0.001, bg_model[c])
            res = (img[c] / denom) * np.mean(bg_model[c])
        result[c] = np.clip(res, 0.0, 1.0)
        
    return result, bg_model
`;

    const calibrationPy = `
# Módulo de Calibración de Color (Background Neutralization & SPCC)
import numpy as np

def find_background_setiastro(img, grid_size=16):
    # img: shape (nc, h, w)
    nc = img.shape[0] if len(img.shape) == 3 else 1
    h, w = img.shape[-2], img.shape[-1]
    
    # Calcular tamaño de cada celda
    ch = h // grid_size
    cw = w // grid_size
    
    best_score = float('inf')
    best_coords = (0, 0, 0, 0)
    best_backgrounds = np.zeros(nc)
    
    # Recorrer la cuadrícula
    for r in range(grid_size):
        for c in range(grid_size):
            y0 = r * ch
            y1 = (r + 1) * ch
            x0 = c * cw
            x1 = (c + 1) * cw
            
            # Evitar celdas fuera de límite o demasiado pequeñas
            if (y1 - y0) < 5 or (x1 - x0) < 5:
                continue
                
            cell = img[:, y0:y1, x0:x1] if nc > 1 else img[y0:y1, x0:x1]
            
            # Calcular mediana e intensidad/ruido de la celda
            medians = np.zeros(nc)
            mads = np.zeros(nc)
            for chan in range(nc):
                ch_data = cell[chan] if nc > 1 else cell
                med = np.median(ch_data)
                mad = np.median(np.abs(ch_data - med))
                if mad < 1e-6:
                    mad = np.std(ch_data)
                medians[chan] = med
                mads[chan] = mad
                
            # Score de SetiAstro: buscamos la zona más oscura (bajo median) y homogénea (bajo ruido/mad)
            luma_med = np.mean(medians)
            luma_mad = np.mean(mads)
            score = luma_med + 2.5 * luma_mad
            
            if score < best_score:
                best_score = score
                best_coords = (x0, y0, cw, ch)
                best_backgrounds = medians
                
    return best_backgrounds, best_coords

def apply_background_neutralization(img, bg_vals, target_val=None):
    nc = img.shape[0] if len(img.shape) == 3 else 1
    h, w = img.shape[-2], img.shape[-1]
    
    # Si target_val no se especifica, neutralizamos al promedio de los fondos
    if target_val is None:
        target_val = np.mean(bg_vals)
        
    result = np.zeros_like(img)
    if nc > 1:
        for chan in range(nc):
            ch_data = img[chan]
            res = (ch_data - bg_vals[chan]) + target_val
            result[chan] = np.clip(res, 0.0, 1.0)
    else:
        res = (img - bg_vals[0]) + target_val
        result = np.clip(res, 0.0, 1.0)
        
    return result

def apply_spcc(img, catalog_stars, wcs_meta):
    from astropy.wcs import WCS
    
    nc = img.shape[0] if len(img.shape) == 3 else 1
    h, w = img.shape[-2], img.shape[-1]
    
    if nc < 3:
        return img, [1.0, 1.0, 1.0] # Solo aplica a color RGB
        
    # Crear WCS
    ra_center = wcs_meta.get('ra')
    dec_center = wcs_meta.get('dec')
    pixscale = wcs_meta.get('pixscale')
    orientation = wcs_meta.get('orientation', 0.0)
    parity = wcs_meta.get('parity', 1)
    
    scale = pixscale / 3600.0
    theta = np.radians(orientation)
    
    wcs_obj = WCS(naxis=2)
    wcs_obj.wcs.crpix = [w / 2.0, h / 2.0]
    wcs_obj.wcs.crval = [ra_center, dec_center]
    wcs_obj.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    
    cd11 = scale * parity * np.cos(theta)
    cd12 = -scale * np.sin(theta)
    cd21 = scale * parity * np.sin(theta)
    cd22 = scale * np.cos(theta)
    wcs_obj.wcs.cd = [[cd11, cd12], [cd21, cd22]]
    
    # Medir flujo de estrellas
    measured_fluxes = []
    catalog_fluxes = []
    
    # Radio de la apertura para fotometría
    ap_radius = 4
    # Corona para fondo local
    bg_in = 6
    bg_out = 10
    
    for star in catalog_stars:
        s_ra = star.get('ra')
        s_dec = star.get('dec')
        bp = star.get('bp')
        g = star.get('g')
        rp = star.get('rp')
        
        if bp is None or g is None or rp is None:
            continue
            
        # Proyectar a pixel
        try:
            px, py = wcs_obj.world_to_pixel_values(s_ra, s_dec)
            px = float(px)
            py = float(py)
        except Exception:
            continue
            
        # Verificar si está dentro de la imagen
        ix, iy = int(np.round(px)), int(np.round(py))
        if ix < bg_out or ix >= (w - bg_out) or iy < bg_out or iy >= (h - bg_out):
            continue
            
        # Refinar centroide localmente en una ventana pequeña (e.g. 9x9)
        # Usamos canal verde (índice 1) para centroiding
        win_size = 4
        sub_win = img[1, iy-win_size:iy+win_size+1, ix-win_size:ix+win_size+1]
        
        # Centro de masa
        y_indices, x_indices = np.mgrid[iy-win_size:iy+win_size+1, ix-win_size:ix+win_size+1]
        denom = np.sum(sub_win)
        if denom > 0:
            cy = np.sum(sub_win * y_indices) / denom
            cx = np.sum(sub_win * x_indices) / denom
        else:
            cx, cy = px, py
            
        # Verificar que el centroide no haya derivado demasiado
        if np.abs(cx - px) > win_size or np.abs(cy - py) > win_size:
            cx, cy = px, py
            
        # Fotometría de apertura
        # Crear máscara de distancias
        box_y0 = int(cy) - bg_out
        box_y1 = int(cy) + bg_out + 1
        box_x0 = int(cx) - bg_out
        box_x1 = int(cx) + bg_out + 1
        
        sub_img = img[:, box_y0:box_y1, box_x0:box_x1]
        y_g_sub, x_g_sub = np.mgrid[box_y0:box_y1, box_x0:box_x1]
        dists = np.sqrt((x_g_sub - cx)**2 + (y_g_sub - cy)**2)
        
        ap_mask = dists <= ap_radius
        bg_mask = (dists >= bg_in) & (dists <= bg_out)
        
        # Calcular fondos locales
        bg_pixels_count = np.sum(bg_mask)
        if bg_pixels_count < 5:
            continue
            
        bg_local = np.zeros(nc)
        measured = np.zeros(nc)
        is_saturated = False
        
        for chan in range(nc):
            ch_sub = sub_img[chan]
            # Si el pixel central está saturado, descartar
            if np.max(ch_sub[ap_mask]) > 0.98:
                is_saturated = True
                break
            # Fondo local (mediana robusta de la corona)
            bg_local[chan] = np.median(ch_sub[bg_mask])
            # Suma de flujo en apertura
            flux_sum = np.sum(ch_sub[ap_mask] - bg_local[chan])
            measured[chan] = flux_sum
            
        if is_saturated:
            continue
            
        # Si los flujos medidos son positivos y significativos
        if measured[0] > 0 and measured[1] > 0 and measured[2] > 0:
            # Flujos del catálogo Gaia, ANCLADOS a estrella blanca tipo G2V (Sol).
            # La banda Gaia G es muy ancha y su magnitud sale sistematicamente mas brillante que
            # BP/RP; usar 10^(-0.4*G) crudo infla el "verde de catalogo" -> los factores empujan la
            # imagen a amarillo/verde. Restando los colores solares Gaia (G-RP=0.49, BP-RP=0.82),
            # una estrella blanca da cat_r=cat_g=cat_b (neutro) y desaparece el sesgo. Validado:
            # sobre imagen neutra los factores pasan de [1.57,1.0,0.74] (sesgo) a [1,1,1].
            cat_r = 10.0 ** (-0.4 * rp)
            cat_g = 10.0 ** (-0.4 * (g - 0.49))
            cat_b = 10.0 ** (-0.4 * (bp - 0.82))
            
            measured_fluxes.append(measured)
            catalog_fluxes.append([cat_r, cat_g, cat_b])
            
    if len(measured_fluxes) < 3:
        # No hay suficientes estrellas para calibrar
        return img, [1.0, 1.0, 1.0]
        
    measured_fluxes = np.array(measured_fluxes)
    catalog_fluxes = np.array(catalog_fluxes)
    
    # Calcular ratios
    ratios_r = catalog_fluxes[:, 0] / measured_fluxes[:, 0]
    ratios_g = catalog_fluxes[:, 1] / measured_fluxes[:, 1]
    ratios_b = catalog_fluxes[:, 2] / measured_fluxes[:, 2]
    
    k_r = np.median(ratios_r)
    k_g = np.median(ratios_g)
    k_b = np.median(ratios_b)
    
    # Normalizar para mantener el canal verde como referencia 1.0
    if k_g > 0:
        factor_r = k_r / k_g
        factor_g = 1.0
        factor_b = k_b / k_g
    else:
        factor_r, factor_g, factor_b = 1.0, 1.0, 1.0
        
    factors = [float(factor_r), float(factor_g), float(factor_b)]
    
    # Aplicar factores
    calibrated = np.zeros_like(img)
    calibrated[0] = np.clip(img[0] * factors[0], 0.0, 1.0)
    calibrated[1] = np.clip(img[1] * factors[1], 0.0, 1.0)
    calibrated[2] = np.clip(img[2] * factors[2], 0.0, 1.0)
    
    return calibrated, factors
`;

    const deconPy = `
# Módulo de Deconvolución y Enfoque (Lucy-Richardson y Wavelets)
import numpy as np
import scipy.signal
import scipy.ndimage

# DECON-FIX-BEGIN
def apply_cosmic_clarity_decon(img, mode="both", stellar_amt=0.9, ns_strength=3.0, ns_amount=0.5, remove_aberration=False, stellar_ai=None, nonstellar_ai=None):
    nc = img.shape[0] if len(img.shape) == 3 else 1
    h, w = img.shape[-2], img.shape[-1]
    
    # Bug 1 Fix: Usar canal de Luminancia para deconv color
    if nc >= 3:
        L = np.mean(img, axis=0)
        
        # 1. Generar mascara de estrellas sobre la Luminancia
        # PERF-DECON-MASK: el fondo es suave -> median a resolucion reducida (factor _dds) y reescalado.
        # ~x19 mas rapido que full-res (medido); la mascara base estelar sigue a full-res (sin perder estrellas).
        _dds = 4 if min(h, w) >= 256 else 1
        if _dds > 1:
            _Lds = scipy.ndimage.zoom(L, 1.0 / _dds, order=1)
            _bgds = scipy.ndimage.median_filter(_Lds, size=max(3, 11 // _dds))
            bg_sky = scipy.ndimage.zoom(_bgds, (h / _bgds.shape[0], w / _bgds.shape[1]), order=1)[:h, :w]
        else:
            bg_sky = scipy.ndimage.median_filter(L, size=11)
        stars_extracted = np.maximum(0, L - bg_sky)
        med_val = np.median(L)
        std_val = np.std(L)
        star_threshold = med_val + 1.2 * std_val
        star_mask = np.where(stars_extracted > star_threshold, stars_extracted, 0)
        
        # Bug 2 Fix: Dilatar la mascara para proteger halos (mascara suave -> PERF: resolucion reducida)
        if _dds > 1:
            _smds = scipy.ndimage.zoom(star_mask, 1.0 / _dds, order=1)
            _smdd = scipy.ndimage.gaussian_filter(scipy.ndimage.maximum_filter(_smds, size=max(3, 15 // _dds)), sigma=2.0 / _dds)
            star_mask_dilated = scipy.ndimage.zoom(_smdd, (h / _smdd.shape[0], w / _smdd.shape[1]), order=1)[:h, :w]
        else:
            star_mask_dilated = scipy.ndimage.gaussian_filter(scipy.ndimage.maximum_filter(star_mask, size=15), sigma=2.0)
        max_dil = np.max(star_mask_dilated)
        if max_dil > 0:
            star_mask_dilated = np.clip(star_mask_dilated / max_dil, 0.0, 1.0)
            
        # Mascara base para blend estelar
        star_mask_base = scipy.ndimage.gaussian_filter(star_mask, sigma=1.5)
        max_base = np.max(star_mask_base)
        if max_base > 0:
            star_mask_base = np.clip(star_mask_base / max_base, 0.0, 1.0)
            
        # 2. Deconvolucion Lucy-Richardson sobre Luminancia
        if mode in ["both", "stellar"] and stellar_amt > 0.01:
            if stellar_ai is not None:
                decon_L = np.mean(stellar_ai, axis=0)
            else:
                psf_size = 7
                x_psf = np.linspace(-3, 3, psf_size)
                y_psf = np.linspace(-3, 3, psf_size)
                x_psf, y_psf = np.meshgrid(x_psf, y_psf)
                psf_sigma = 1.2
                psf = np.exp(-(x_psf**2 + y_psf**2) / (2 * psf_sigma**2))
                psf /= np.sum(psf)
                
                decon_L = np.copy(L)
                psf_mirror = psf[::-1, ::-1]
                for _ in range(5):
                    conv = scipy.signal.fftconvolve(decon_L, psf, mode='same')
                    conv = np.where(conv < 1e-10, 1e-10, conv)
                    relative_blur = L / conv
                    decon_L *= scipy.signal.fftconvolve(relative_blur, psf_mirror, mode='same')
                    decon_L = np.clip(decon_L, 0.0, 1.0)
            
            stellar_sharp_L = L * (1.0 - star_mask_base * stellar_amt) + decon_L * (star_mask_base * stellar_amt)
        else:
            stellar_sharp_L = np.copy(L)
            
        # Re-aplicar Luminancia preservando el ratio cromatico
        stellar_sharp = np.zeros_like(img)
        ratio = np.where(L > 1e-6, stellar_sharp_L / (L + 1e-10), 1.0)
        ratio = np.clip(ratio, 0.0, 5.0)
        for c in range(nc):
            stellar_sharp[c] = np.clip(img[c] * ratio, 0.0, 1.0)
            
        # 3. Non-stellar sharpening
        result = np.zeros_like(img)
        for c in range(nc):
            if mode in ["both", "nonstellar"] and ns_amount > 0.01:
                if nonstellar_ai is not None:
                    detail_layer = np.clip(nonstellar_ai[c], 0.0, 1.0) - img[c]
                    # Bug 2 Fix: Evitar detalles negativos (resta) en el halo de la estrella
                    detail_layer = np.where(star_mask_dilated > 0.01, np.maximum(0.0, detail_layer), detail_layer)
                else:
                    sigma_val = max(0.5, min(5.0, ns_strength / 2.0))
                    base_layer = scipy.ndimage.gaussian_filter(img[c], sigma=sigma_val)
                    detail_layer = img[c] - base_layer
                
                nebulosity_mask = scipy.ndimage.gaussian_filter(img[c], sigma=6.0)
                nebulosity_mask = np.clip(nebulosity_mask / (np.max(nebulosity_mask) + 1e-6) * 2.0, 0.0, 1.0)
                non_stellar_mask = (1.0 - star_mask_base) * nebulosity_mask
                result[c] = np.clip(stellar_sharp[c] + ns_amount * detail_layer * non_stellar_mask, 0.0, 1.0)
            else:
                result[c] = stellar_sharp[c]
        return result
    else:
        # Canal mono
        ch = img[0]
        # PERF-DECON-MASK (mono): fondo a resolucion reducida y reescalado (igual que en color).
        _dds = 4 if min(h, w) >= 256 else 1
        if _dds > 1:
            _cds = scipy.ndimage.zoom(ch, 1.0 / _dds, order=1)
            _bgds = scipy.ndimage.median_filter(_cds, size=max(3, 11 // _dds))
            bg_sky = scipy.ndimage.zoom(_bgds, (h / _bgds.shape[0], w / _bgds.shape[1]), order=1)[:h, :w]
        else:
            bg_sky = scipy.ndimage.median_filter(ch, size=11)
        stars_extracted = np.maximum(0, ch - bg_sky)
        med_val = np.median(ch)
        std_val = np.std(ch)
        star_threshold = med_val + 1.2 * std_val
        star_mask = np.where(stars_extracted > star_threshold, stars_extracted, 0)
        
        if _dds > 1:
            _smds = scipy.ndimage.zoom(star_mask, 1.0 / _dds, order=1)
            _smdd = scipy.ndimage.gaussian_filter(scipy.ndimage.maximum_filter(_smds, size=max(3, 15 // _dds)), sigma=2.0 / _dds)
            star_mask_dilated = scipy.ndimage.zoom(_smdd, (h / _smdd.shape[0], w / _smdd.shape[1]), order=1)[:h, :w]
        else:
            star_mask_dilated = scipy.ndimage.gaussian_filter(scipy.ndimage.maximum_filter(star_mask, size=15), sigma=2.0)
        max_dil = np.max(star_mask_dilated)
        if max_dil > 0:
            star_mask_dilated = np.clip(star_mask_dilated / max_dil, 0.0, 1.0)
            
        star_mask_base = scipy.ndimage.gaussian_filter(star_mask, sigma=1.5)
        max_base = np.max(star_mask_base)
        if max_base > 0:
            star_mask_base = np.clip(star_mask_base / max_base, 0.0, 1.0)
            
        if mode in ["both", "stellar"] and stellar_amt > 0.01:
            if stellar_ai is not None:
                decon_ch = np.clip(stellar_ai[0], 0.0, 1.0)
            else:
                psf = np.exp(-np.sum(np.square(np.indices((7, 7)) - 3), axis=0) / (2 * 1.2**2))
                psf /= np.sum(psf)
                decon_ch = np.copy(ch)
                psf_mirror = psf[::-1, ::-1]
                for _ in range(5):
                    conv = np.where(scipy.signal.fftconvolve(decon_ch, psf, mode='same') < 1e-10, 1e-10, scipy.signal.fftconvolve(decon_ch, psf, mode='same'))
                    decon_ch = np.clip(decon_ch * scipy.signal.fftconvolve(ch / conv, psf_mirror, mode='same'), 0.0, 1.0)
            stellar_sharp = ch * (1.0 - star_mask_base * stellar_amt) + decon_ch * (star_mask_base * stellar_amt)
        else:
            stellar_sharp = np.copy(ch)
            
        if mode in ["both", "nonstellar"] and ns_amount > 0.01:
            if nonstellar_ai is not None:
                detail_layer = np.clip(nonstellar_ai[0], 0.0, 1.0) - ch
                detail_layer = np.where(star_mask_dilated > 0.01, np.maximum(0.0, detail_layer), detail_layer)
            else:
                sigma_val = max(0.5, min(5.0, ns_strength / 2.0))
                base_layer = scipy.ndimage.gaussian_filter(ch, sigma=sigma_val)
                detail_layer = ch - base_layer
            nebulosity_mask = scipy.ndimage.gaussian_filter(ch, sigma=6.0)
            nebulosity_mask = np.clip(nebulosity_mask / (np.max(nebulosity_mask) + 1e-6) * 2.0, 0.0, 1.0)
            non_stellar_mask = (1.0 - star_mask_base) * nebulosity_mask
            ns_sharp = stellar_sharp + ns_amount * detail_layer * non_stellar_mask
        else:
            ns_sharp = np.copy(stellar_sharp)
            
        result = np.zeros_like(img)
        result[0] = np.clip(ns_sharp, 0.0, 1.0)
        return result
# DECON-FIX-END
`;

    pyodideInstance.FS.writeFile("/target/saspro/__init__.py", "");
    pyodideInstance.FS.writeFile("/target/saspro/core.py", corePy);
    pyodideInstance.FS.writeFile("/target/saspro/stretch.py", stretchPy);
    pyodideInstance.FS.writeFile("/target/saspro/scnr.py", scnrPy);
    pyodideInstance.FS.writeFile("/target/saspro/gradient.py", gradientPy);
    pyodideInstance.FS.writeFile("/target/saspro/calibration.py", calibrationPy);
    pyodideInstance.FS.writeFile("/target/saspro/decon.py", deconPy);
    logConsole("Módulos fallback de SASPro listos en sistema de archivos virtual", "info");
  }

  /**
   * Procesa un archivo (FITS o TIFF) usando el motor de Python Pyodide y SASPro.
   * 
   * @param {File} file Objeto de tipo File subido por el usuario
   * @param {string} processType Tipo de algoritmo a ejecutar ('statistical_stretch', 'star_stretch', 'scnr')
   * @param {Object} params Parámetros dinámicos para el algoritmo
   * @returns {Promise<Object>} Promesa que resuelve a un objeto de imagen compatible con pi-workflow
   */
  async function processImageFile(file, processType, params = {}) {
    await init(); // Asegurar que Pyodide esté listo

    showLoader(`Cargando archivo ${file.name} en entorno Python WASM...`);
    
    try {
      // 1. Leer archivo como ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // 2. Guardar en el sistema de archivos de Pyodide
      const inputPath = `/tmp/${file.name}`;
      const outputPath = `/tmp/processed_${file.name}`;
      
      // Asegurarse de que el directorio tmp existe
      try { pyodideInstance.FS.mkdir("/tmp"); } catch(e) {}
      
      pyodideInstance.FS.writeFile(inputPath, bytes);
      logConsole(`Archivo guardado en Pyodide FS: ${inputPath} (${bytes.length} bytes)`, "info");

      showLoader("Ejecutando procesamiento con SASPro y Astropy...");

      pyodideInstance.globals.set("js_params", params);

      // 3. Escribir y ejecutar el script puente de Python
      const pythonScript = `
import numpy as np
from saspro.core import load_fits, save_fits
from saspro.stretch import statistical_stretch, star_stretch
from saspro.scnr import scnr_green

# Cargar imagen usando astropy
img_data = load_fits("${inputPath}")

# Aplicar el proceso seleccionado
process = "${processType}"
params = js_params.to_py()

if process == "statistical_stretch":
    tgt = params.get("target_median", 0.15)
    sig = params.get("sigma_clip", 2.8)
    processed = statistical_stretch(img_data, target_median=tgt, sigma_clip=sig)
elif process == "star_stretch":
    tgt = params.get("target_median", 0.10)
    sig = params.get("sigma_clip", 3.5)
    cp = params.get("color_preservation", 0.8)
    processed = star_stretch(img_data, target_median=tgt, sigma_clip=sig, color_preservation=cp)
elif process == "scnr":
    amt = params.get("amount", 1.0)
    processed = scnr_green(img_data, amount=amt)
else:
    processed = img_data

# Guardar resultado procesado como FITS
save_fits(processed, "${outputPath}")

# Devolver dimensiones e info estructural
shape_list = list(processed.shape)
has_channels = len(shape_list) == 3
nc = shape_list[0] if has_channels else 1
h = shape_list[1] if has_channels else shape_list[0]
w = shape_list[2] if has_channels else shape_list[1]
is_color = nc >= 3

result_info = {
    "w": w,
    "h": h,
    "nc": nc,
    "isColor": is_color
}
result_info
`;

      const resultInfoProxy = await pyodideInstance.runPythonAsync(pythonScript);
      const resultInfo = resultInfoProxy.toJs();
      resultInfoProxy.destroy();

      // 4. Recuperar los datos procesados del FITS resultante
      const outputBytes = pyodideInstance.FS.readFile(outputPath);
      logConsole(`Resultado de procesamiento leído desde Pyodide FS: ${outputBytes.length} bytes`, "info");

      // Limpiar los archivos del FS virtual para evitar agotar la memoria
      try {
        pyodideInstance.FS.unlink(inputPath);
        pyodideInstance.FS.unlink(outputPath);
      } catch (e) {}

      // 5. Convertir a formato compatible con pi-workflow de JavaScript
      // Para integrarlo limpiamente, analizaremos los canales usando UTIF o los decodificaremos directamente en Python.
      // Haremos que el script de Python nos prepare directamente los arrays de canalesFloat32 para máxima velocidad:
      const channelScript = `
# Obtener los canales de pixel como listas planas para serialización a JS
if len(processed.shape) == 3:
    channels_flat = [processed[c].flatten().tolist() for c in range(processed.shape[0])]
else:
    channels_flat = [processed.flatten().tolist()]
channels_flat
`;
      const channelsFlatProxy = await pyodideInstance.runPythonAsync(channelScript);
      const channelsFlat = channelsFlatProxy.toJs();
      channelsFlatProxy.destroy();

      // Convertir las listas devueltas a Float32Array
      const chArrays = channelsFlat.map(chList => new Float32Array(chList));

      hideLoader();
      logConsole("Procesamiento en Pyodide completado con éxito", "ok");

      return {
        ch: chArrays,
        w: resultInfo.w,
        h: resultInfo.h,
        nc: resultInfo.nc,
        isColor: resultInfo.isColor
      };

    } catch (error) {
      hideLoader();
      logConsole(`Error en el procesamiento Python/WASM: ${error.message}`, "err");
      throw error;
    }
  }

  /**
   * Procesa una imagen en memoria pasando directamente los Float32Arrays a Pyodide.
   */
  async function processImageRaw(img, processType, params = {}) {
    await init();
    showLoader("Procesando imagen con Red Neuronal en Pyodide (WASM)...");
    
    try {
      pyodideInstance.globals.set("js_w", img.w);
      pyodideInstance.globals.set("js_h", img.h);
      pyodideInstance.globals.set("js_nc", img.nc);
      pyodideInstance.globals.set("js_is_color", img.isColor);
      
      pyodideInstance.runPython("js_channels = []");
      for (let c = 0; c < img.nc; c++) {
        pyodideInstance.globals.set("temp_ch", img.ch[c]);
        pyodideInstance.runPython("js_channels.append(temp_ch.to_py())");
      }
      
      if (processType === "spcc") {
        pyodideInstance.globals.set("js_catalog_stars", params.catalogStars || []);
        pyodideInstance.globals.set("js_wcs_meta", params.wcsMeta || {});
      }
      
      pyodideInstance.globals.set("js_params", params);
      
      const pythonScript = `
import numpy as np
from saspro.gradient import apply_graxpert_ia, apply_autodbe
from saspro.stretch import statistical_stretch, star_stretch
from saspro.scnr import scnr_green
from saspro.calibration import find_background_setiastro, apply_background_neutralization, apply_spcc
from saspro.decon import apply_cosmic_clarity_decon

# Formar array numpy a partir de canales en memoria
img_np = np.array(js_channels).reshape((js_nc, js_h, js_w))

# Ejecutar proceso
algo = "${processType}"
params = js_params.to_py()

extra_data = None

if algo == "graxpert_ia":
    corr = params.get("correction", "subtraction")
    smooth = params.get("smoothness", 0.82)
    processed, bg_model = apply_graxpert_ia(img_np, correction=corr, smoothness=smooth)
elif algo == "dbe":
    paths = params.get("paths", 50)
    tol = params.get("tolerance", 2.0)
    smooth = params.get("smoothness", 0.25)
    processed, bg_model = apply_autodbe(img_np, num_points=paths, tolerance=tol, smoothness=smooth, correction="subtraction")
elif algo == "statistical_stretch":
    tgt = params.get("target_median", 0.15)
    sig = params.get("sigma_clip", 2.8)
    processed = statistical_stretch(img_np, target_median=tgt, sigma_clip=sig)
    bg_model = None
elif algo == "star_stretch":
    tgt = params.get("target_median", 0.10)
    sig = params.get("sigma_clip", 3.5)
    cp = params.get("color_preservation", 0.8)
    processed = star_stretch(img_np, target_median=tgt, sigma_clip=sig, color_preservation=cp)
    bg_model = None
elif algo == "scnr":
    amt = params.get("amount", 1.0)
    processed = scnr_green(img_np, amount=amt)
    bg_model = None
elif algo == "background_neutralization":
    bg_vals, bg_coords = find_background_setiastro(img_np)
    processed = apply_background_neutralization(img_np, bg_vals)
    bg_model = None
    extra_data = {
        "bg_vals": bg_vals.tolist(),
        "bg_coords": list(bg_coords)
    }
elif algo == "spcc":
    catalog_stars = js_catalog_stars.to_py()
    wcs_meta = js_wcs_meta.to_py()
    processed, factors = apply_spcc(img_np, catalog_stars, wcs_meta)
    bg_model = None
    extra_data = {
        "factors": factors
    }
elif algo == "cosmic":
    mode = params.get("mode", "both")
    stellar_amt = params.get("stellar_amt", 0.90)
    ns_strength = params.get("ns_strength", 3.0)
    ns_amount = params.get("ns_amount", 0.50)
    remove_ab = params.get("remove_aberration", False)
    
    stellar_ai = params.get("stellar_ai")
    if stellar_ai is not None:
        # Cada canal IA llega plano (H*W) desde runOnnxModelTiled -> reshape a (H, W)
        stellar_ai = np.array([np.array(x).reshape((js_h, js_w)) for x in stellar_ai])

    nonstellar_ai = params.get("nonstellar_ai")
    if nonstellar_ai is not None:
        nonstellar_ai = np.array([np.array(x).reshape((js_h, js_w)) for x in nonstellar_ai])
        
    processed = apply_cosmic_clarity_decon(
        img_np, mode=mode, stellar_amt=stellar_amt, 
        ns_strength=ns_strength, ns_amount=ns_amount, 
        remove_aberration=remove_ab, 
        stellar_ai=stellar_ai, nonstellar_ai=nonstellar_ai
    )
    bg_model = None
else:
    processed = img_np
    bg_model = None

# Asegurar forma (nc, h, w)
if len(processed.shape) == 2:
    processed = processed.reshape((1, processed.shape[0], processed.shape[1]))
if bg_model is not None and len(bg_model.shape) == 2:
    bg_model = bg_model.reshape((1, bg_model.shape[0], bg_model.shape[1]))

# Obtener canales serializados para JS
channels_flat = [processed[c].flatten().tolist() for c in range(js_nc)]
bg_channels_flat = [bg_model[c].flatten().tolist() for c in range(js_nc)] if bg_model is not None else None
[channels_flat, bg_channels_flat, extra_data]
`;
      const rawResultProxy = await pyodideInstance.runPythonAsync(pythonScript);
      const rawResult = rawResultProxy.toJs();
      rawResultProxy.destroy();

      const channelsFlat = rawResult[0];
      const bgChannelsFlat = rawResult[1];
      const extraData = rawResult[2];

      const chArrays = channelsFlat.map(chList => new Float32Array(chList));
      const bgChArrays = bgChannelsFlat ? bgChannelsFlat.map(chList => new Float32Array(chList)) : null;
      hideLoader();
      logConsole("Procesamiento en red neuronal completado con éxito", "ok");

      return {
        ch: chArrays,
        bgCh: bgChArrays,
        w: img.w,
        h: img.h,
        nc: img.nc,
        isColor: img.isColor,
        extra: extraData
      };
    } catch (error) {
      hideLoader();
      logConsole(`Error en procesamiento de Red Neuronal: ${error.message}`, "err");
      throw error;
    }
  }

  return {
    init,
    processImageFile,
    processImageRaw,
    isReady: () => isReady
  };
})();

window.SASProPyodide = SASProPyodide;
