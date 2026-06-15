import os
import json
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime
import re
import sys
import ssl

# Bypass SSL certificate validation globally for safety with astronomy vendor servers
ssl_context = ssl._create_unverified_context()

# Redefine print to handle Windows encoding issues with emojis
_original_print = print
def print(*args, **kwargs):
    cleaned_args = []
    for arg in args:
        if isinstance(arg, str):
            encoding = getattr(sys.stdout, 'encoding', 'utf-8') or 'utf-8'
            cleaned_args.append(arg.encode(encoding, errors='replace').decode(encoding))
        else:
            cleaned_args.append(arg)
    _original_print(*cleaned_args, **kwargs)

# Database and Scraping Config
DB_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "equipamiento.json")
MAX_ITEMS_TO_PROCESS = 12  # Process max 12 new items per run
MAX_DB_SIZE = 150         # Keep DB file size balanced
# Prioridad de canales oficiales sobre terceros (reviewers/foros):
MAX_OTHER_ITEMS = 5       # Tope de items de fuentes NO oficiales por run (reserva capacidad para oficiales)
MFG_MAX_AGE_DAYS = 14     # Ventana de antigüedad para fuentes oficiales (más amplia: publican con menos frecuencia)
OTHER_MAX_AGE_DAYS = 3    # Ventana de antigüedad para terceros (corta: evita captar reviews tardías como novedad)

# Load Centralized YouTubers/Creators
TOOLS_DIR = os.path.dirname(__file__)
CREATORES_FILE = os.path.join(TOOLS_DIR, "creadores.json")
YOUTUBE_SOURCES = []
if os.path.exists(CREATORES_FILE):
    try:
        with open(CREATORES_FILE, "r", encoding="utf-8") as f:
            creators_data = json.load(f)
            for c in creators_data:
                YOUTUBE_SOURCES.append({
                    "name": c["name"],
                    "url": f"https://www.youtube.com/feeds/videos.xml?channel_id={c['channel_id']}",
                    "is_youtube": True,
                    "is_mfg": False
                })
    except Exception as e:
        print(f"Error loading creadores.json: {e}")

# Fallback default list if json file is missing
if not YOUTUBE_SOURCES:
    YOUTUBE_SOURCES = [
        {"name": "Adam Block", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCrN82DzPssKUZj2ltFz00VQ", "is_youtube": True, "is_mfg": False},
        {"name": "Cuiv, The Lazy Geek", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCZ5qRydYf3lMJ9A63cvsSEA", "is_youtube": True, "is_mfg": False},
        {"name": "The Space Koala", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCToyE26Iy4-gwi4BowKWClQ", "is_youtube": True, "is_mfg": False},
        {"name": "SetiAstro", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCHeW7wuxfjhMmymXC9KqIbg", "is_youtube": True, "is_mfg": False},
        {"name": "Patriot Astro", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCyf4zn4wd-W4FnBwV98-jXw", "is_youtube": True, "is_mfg": False},
        {"name": "Utah Desert Remote Observatories", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCAP_JNj5koMchEFXnhirwnQ", "is_youtube": True, "is_mfg": False},
        {"name": "Lukomatico", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCBTXZYuFWQ6lx51L4GeY0Lw", "is_youtube": True, "is_mfg": False},
        {"name": "TAIC", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCiR5AmROq4YcXF8hCxxZQ-g", "is_youtube": True, "is_mfg": False},
        {"name": "View into Space", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCW1F7nyBqtNTzaSWcrpx9LQ", "is_youtube": True, "is_mfg": False},
        {"name": "Nebula Photos", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCO_gBdHekc74feh0bWqKJ1Q", "is_youtube": True, "is_mfg": False},
        {"name": "Astro Academy", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC56nUa0BeuHUsE3TM0MCpFg", "is_youtube": True, "is_mfg": False},
        {"name": "Natural Portraits", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCQrYBVmH3Gz9IO5ryXIGhdw", "is_youtube": True, "is_mfg": False},
        {"name": "Astrocitas", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCO7DwcTu__SZs1a65W99SFA", "is_youtube": True, "is_mfg": False},
        {"name": "Astrotivissa", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCIOTjw9A7ckpkCEbdowmV_g", "is_youtube": True, "is_mfg": False},
        {"name": "Naztronomy", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC5L9FO_dFC5ypLPDk1kwopQ", "is_youtube": True, "is_mfg": False},
        {"name": "Astrocity", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCQ-_45PTOmE3ukoWHvmmjoA", "is_youtube": True, "is_mfg": False},
        {"name": "Ed Ting", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCEQnX-WohTBNGBV5gdhAS5w", "is_youtube": True, "is_mfg": False},
        {"name": "Dylan O'Donnell", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCgOf4wBnoGg8WHHHr_h4otQ", "is_youtube": True, "is_mfg": False},
        {"name": "Astrobackyard", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCn3npsPixgoi_xLdCg9J-LQ", "is_youtube": True, "is_mfg": False}
    ]

# MFG-SOURCES-JSON-BEGIN
def load_mfg_sources():
    """Carga las fuentes de canales OFICIALES de fabricantes desde fabricantes_fuentes.json.
    Cada entrada puede tener 'rss' y/o 'youtube_channel_id'; se genera una fuente por cada uno.
    Devuelve [] si el fichero falta o está vacío (entonces se usa el fallback hardcodeado)."""
    fuentes_file = os.path.join(TOOLS_DIR, "fabricantes_fuentes.json")
    sources = []
    if os.path.exists(fuentes_file):
        try:
            with open(fuentes_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            for m in data:
                name = (m.get("name") or "").strip()
                if not name:
                    continue
                if m.get("rss"):
                    sources.append({"name": name, "url": m["rss"], "is_youtube": False, "is_mfg": True})
                if m.get("youtube_channel_id"):
                    sources.append({
                        "name": f"{name} (YouTube)",
                        "url": f"https://www.youtube.com/feeds/videos.xml?channel_id={m['youtube_channel_id']}",
                        "is_youtube": True, "is_mfg": True
                    })
        except Exception as e:
            print(f"Error loading fabricantes_fuentes.json: {e}")
    return sources

# Canales OFICIALES de fabricantes (preferidos). Se cargan del JSON; añadir uno = editar el JSON.
MFG_SOURCES = load_mfg_sources()

# Fuentes comunitarias / terceros (foros, agregadores) — NO oficiales.
COMMUNITY_SOURCES = [
    {"name": "Stargazers Lounge", "url": "https://stargazerslounge.com/discover/all.xml/", "is_youtube": False, "is_mfg": False},
    {"name": "Reddit r/astrophotography", "url": "https://www.reddit.com/r/astrophotography/new/.rss", "is_youtube": False, "is_mfg": False},
    {"name": "Reddit r/telescopes", "url": "https://www.reddit.com/r/telescopes/new/.rss", "is_youtube": False, "is_mfg": False}
]

# Fallback hardcodeado: solo se usa si fabricantes_fuentes.json falta o está vacío.
if not MFG_SOURCES:
    MFG_SOURCES = [
        {"name": "ZWO", "url": "https://www.zwoastro.com/feed/", "is_youtube": False, "is_mfg": True},
        {"name": "Pegasus Astro", "url": "https://pegasusastro.com/feed/", "is_youtube": False, "is_mfg": True},
        {"name": "Player One Astronomy", "url": "https://player-one-astronomy.com/feed/", "is_youtube": False, "is_mfg": True},
        {"name": "PrimaLuceLab", "url": "https://www.primalucelab.com/blog/feed/", "is_youtube": False, "is_mfg": True},
        {"name": "Planewave", "url": "https://planewave.com/feed/", "is_youtube": False, "is_mfg": True},
        {"name": "William Optics", "url": "https://williamoptics.com/blogs/news.atom", "is_youtube": False, "is_mfg": True},
        {"name": "Celestron", "url": "https://www.celestron.com/blogs/news.atom", "is_youtube": False, "is_mfg": True},
        {"name": "Sky-Watcher USA", "url": "https://www.skywatcherusa.com/blogs/news.atom", "is_youtube": False, "is_mfg": True},
        {"name": "Explore Scientific", "url": "https://explorescientific.com/blogs/news.atom", "is_youtube": False, "is_mfg": True},
        {"name": "Lunt Solar Systems", "url": "https://luntsolarsystems.com/blogs/news.atom", "is_youtube": False, "is_mfg": True},
        {"name": "Sharpstar Optics (Askar) (YouTube)", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCx5_u4lWL-h4AaWHWUShNQ", "is_youtube": True, "is_mfg": True},
        {"name": "ToupTek Astro (YouTube)", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCW18EYF2VsFbqAsx6wUT3fw", "is_youtube": True, "is_mfg": True},
        {"name": "ZWO (YouTube)", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCAmDsyAh8Y0BeCN2Gs5pxrg", "is_youtube": True, "is_mfg": True},
        {"name": "QHYCCD (YouTube)", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCnnNYIoCenqfQS7viiex9ww", "is_youtube": True, "is_mfg": True},
        {"name": "Svbony (YouTube)", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCPY-1ni4gqa83qmFEujXFIw", "is_youtube": True, "is_mfg": True}
    ]

# Composición final. El orden no afecta a la prioridad: main() reordena por is_mfg (oficiales primero).
SOURCES = MFG_SOURCES + COMMUNITY_SOURCES + YOUTUBE_SOURCES
# MFG-SOURCES-JSON-END


GITHUB_REPOS = [
    {"name": "N.I.N.A.", "repo": "isbeorn/nina", "category_es": "SOFTWARE", "category_en": "SOFTWARE"},
    {"name": "PHD2 Guiding", "repo": "OpenPHDGuiding/phd2", "category_es": "SOFTWARE", "category_en": "SOFTWARE"},
    {"name": "INDI Library", "repo": "indilib/indi", "category_es": "SOFTWARE", "category_en": "SOFTWARE"},
    {"name": "Stellarium", "repo": "Stellarium/stellarium", "category_es": "SOFTWARE", "category_en": "SOFTWARE"},
    {"name": "SetiAstro SAS", "repo": "setiastro/setiastrosuite", "category_es": "SOFTWARE", "category_en": "SOFTWARE"}
]

GITLAB_REPOS = [
    {"name": "Siril", "project": "free-astro/siril", "category_es": "SOFTWARE", "category_en": "SOFTWARE"}
]

def fetch_feed_items(source_info):
    """Fetches and parses items from a single RSS or Atom feed with SSL bypass."""
    url = source_info["url"]
    is_youtube = source_info["is_youtube"]
    
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, context=ssl_context, timeout=12) as response:
            xml_data = response.read()
            
        root = ET.fromstring(xml_data)
        tag_name = root.tag
        results = []
        
        # Atom XML Feed (YouTube and Shopify Feeds like Celestron/William Optics)
        if "feed" in tag_name.lower():
            ns = {
                'atom': 'http://www.w3.org/2005/Atom'
            }
            
            entries = root.findall('atom:entry', ns)
            for entry in entries:
                title_el = entry.find('atom:title', ns)
                title = title_el.text.strip() if title_el is not None and title_el.text else ""
                
                link_el = entry.find('atom:link[@rel="alternate"]', ns)
                if link_el is None:
                    link_el = entry.find('atom:link', ns)
                link = link_el.attrib.get('href', '').strip() if link_el is not None else ""
                if "stargazerslounge.com/topic/" in link:
                    link = link.split('?')[0]
                
                pub_date_el = entry.find('atom:published', ns)
                if pub_date_el is None:
                    pub_date_el = entry.find('atom:updated', ns)
                pub_date_str = pub_date_el.text.strip() if pub_date_el is not None and pub_date_el.text else ""
                
                author = source_info["name"]
                
                # Format: "2026-06-02T15:00:00+00:00" -> "2026-06-02"
                date_formatted = pub_date_str.split('T')[0] if 'T' in pub_date_str else datetime.now().strftime("%Y-%m-%d")
                
                if title and link:
                    results.append({
                        "id": link,
                        "title": title,
                        "url": link,
                        "date": date_formatted,
                        "source": author,
                        "is_youtube": is_youtube,
                        "is_mfg": source_info.get("is_mfg", False)
                    })
                    
        # RSS 2.0 Feed
        else:
            channel = root.find('channel')
            if channel is not None:
                items = channel.findall('item')
                for item in items:
                    title = item.find('title').text.strip() if item.find('title') is not None and item.find('title').text else ""
                    link = item.find('link').text.strip() if item.find('link') is not None and item.find('link').text else ""
                    if "stargazerslounge.com/topic/" in link:
                        link = link.split('?')[0]
                    pub_date_str = item.find('pubDate').text.strip() if item.find('pubDate') is not None and item.find('pubDate').text else ""
                    
                    try:
                        clean_date_str = pub_date_str.split(' +')[0].split(' -')[0].strip()
                        dt = datetime.strptime(clean_date_str, "%a, %d %b %Y %H:%M:%S")
                        date_formatted = dt.strftime("%Y-%m-%d")
                    except Exception:
                        date_formatted = datetime.now().strftime("%Y-%m-%d")
                        
                    if title and link:
                        results.append({
                            "id": link,
                            "title": title,
                            "url": link,
                            "date": date_formatted,
                            "source": source_info["name"],
                            "is_youtube": is_youtube,
                            "is_mfg": source_info.get("is_mfg", False)
                        })
        return results
    except Exception as e:
        print(f"Error fetching feed '{source_info['name']}': {e}")
        return []

def fetch_github_release(repo_info):
    """Fetches the latest release for a GitHub repository."""
    repo = repo_info["repo"]
    url = f"https://api.github.com/repos/{repo}/releases/latest"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, context=ssl_context, timeout=12) as response:
            data = json.loads(response.read().decode('utf-8'))
            
        tag = data.get('tag_name', '')
        name = data.get('name', '')
        pub_date = data.get('published_at', '')
        html_url = data.get('html_url', '')
        body = data.get('body', '')
        
        date_formatted = pub_date.split('T')[0] if 'T' in pub_date else datetime.now().strftime("%Y-%m-%d")
        version_title = name if name else tag
        
        if html_url:
            return {
                "id": html_url,
                "title": f"{repo_info['name']} Release {version_title}",
                "url": html_url,
                "date": date_formatted,
                "source": f"GitHub Releases ({repo_info['name']})",
                "is_youtube": False,
                "is_mfg": True,
                "body_content": body
            }
    except Exception as e:
        print(f"Error fetching GitHub release for '{repo}': {e}")
        
    return None

def fetch_gitlab_release(repo_info):
    """Fetches the latest release for a GitLab repository."""
    project = repo_info["project"]
    project_encoded = urllib.parse.quote_plus(project)
    url = f"https://gitlab.com/api/v4/projects/{project_encoded}/releases"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, context=ssl_context, timeout=12) as response:
            data = json.loads(response.read().decode('utf-8'))
            
        if data and isinstance(data, list):
            latest = data[0]
            tag = latest.get('tag_name', '')
            name = latest.get('name', '')
            released_at = latest.get('released_at', '')
            description = latest.get('description', '')
            
            date_formatted = released_at.split('T')[0] if 'T' in released_at else datetime.now().strftime("%Y-%m-%d")
            version_title = name if name else tag
            html_url = f"https://gitlab.com/{project}/-/releases/{tag}"
            
            return {
                "id": html_url,
                "title": f"{repo_info['name']} Release {version_title}",
                "url": html_url,
                "date": date_formatted,
                "source": f"GitLab Releases ({repo_info['name']})",
                "is_youtube": False,
                "is_mfg": True,
                "body_content": description
            }
    except Exception as e:
        print(f"Error fetching GitLab release for '{project}': {e}")
        
    return None

def load_database():
    """Loads the database of equipment updates."""
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading DB: {e}")
            return []
    return []

def save_database(data):
    """Saves the database to the JSON file."""
    try:
        with open(DB_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Successfully saved {len(data)} items to database.")
    except Exception as e:
        print(f"Error saving DB: {e}")

def process_with_gemini(item, api_key):
    """Uses the Gemini 2.5 API with responseSchema to translate, summarize, and filter equipment relevance."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    
    body_content = item.get("body_content", "")
    body_prompt = ""
    if body_content:
        body_trimmed = body_content[:1500] + "..." if len(body_content) > 1500 else body_content
        body_prompt = f"\nRelease Notes / Details:\n{body_trimmed}\n"

    prompt = f"""
    You are an expert astrophotographer and astrophotography equipment specialist.
    Analyze the following resource.
    
    Title: "{item['title']}"
    Source/Creator: "{item['source']}"
    URL: {item['url']}
    {body_prompt}
    
    Decide if this resource is directly relevant to astrophotography equipment news, new product announcements, hardware releases, firmware updates, software for capturing (like ASIAIR, N.I.N.A., Pegasus Unity, EKOS/INDI, etc.), or detailed reviews of astrophotography equipment (telescopes, mounts, cameras, filters, focusers, rotators, adapters, observatory gear).
    
    CRITICAL FILTERING AND VALIDATION RULES:
    1. STRICTLY REJECT ALL SELF-REFERENCED FORUM/REDDIT POSTS:
       - Reject posts/threads where a user is showing off or sharing their personal equipment purchase, acquisition, or unboxing (e.g., "My new AM5 mount has arrived!", "Look at my new telescope setup", "Unboxing my new camera").
       - Reject posts showcasing user-taken astrophotography images (e.g., "First light with my new camera", "NGC 7000 taken with my new telescope", "Testing my new mount on M31").
       - Reject posts about custom DIY projects, 3D printing custom parts, custom DIY mounts, or personal telescope modifications unless they are commercialized, mass-produced products being launched.
       - Reject posts that are general troubleshooting, support requests, or questions on how to use a product (e.g., "Why is my mount not guiding?", "Help with Seestar polar alignment").
    2. ONLY ACCEPT COMMERCIAL RELEASES AND OFFICIAL NEWS:
       - Only accept posts/threads about official new commercial product releases or announcements by manufacturers (e.g., ZWO, Celestron, Pegasus Astro, Sky-Watcher, Askar, Player One, etc.), legitimate product leaks/rumors of upcoming commercial gear, or professional/detailed reviews of newly released commercial gear.
       - A thread/post is valid ONLY if it refers to a brand new commercial product that is being released to the market and discussed/referenced by other sources, NOT a single user's personal DIY build or personal purchase.
    3. If the resource violates any rejection rule or does not contain general commercial new product announcement/news/reviews, mark relevant = false.
    
    Return the response as a JSON object matching the requested schema.
    """
    
    payload = {
        "contents": [{
            "parts": [{
                "text": prompt
            }]
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "relevant": {
                        "type": "BOOLEAN",
                        "description": "True if directly relevant to astrophotography equipment, reviews, firmware/software updates, or hardware news. False otherwise."
                    },
                    "title_es": {
                        "type": "STRING", 
                        "description": "Título en español limpio y natural (traducido y adaptado, sin emojis excesivos ni clickbait de YouTube)."
                    },
                    "title_en": {
                        "type": "STRING", 
                        "description": "A refined, clean title in English."
                    },
                    "summary_es": {
                        "type": "STRING", 
                        "description": "Resumen técnico de 2 o 3 frases en español detallando de qué trata este equipamiento, análisis o actualización."
                    },
                    "summary_en": {
                        "type": "STRING", 
                        "description": "A concise technical summary in English of 2 to 3 sentences."
                    },
                    "category_es": {
                        "type": "STRING", 
                        "enum": ["TELESCOPIOS", "CÁMARAS", "MONTURAS", "ACCESORIOS", "SOFTWARE"]
                    },
                    "category_en": {
                        "type": "STRING", 
                        "enum": ["TELESCOPES", "CAMERAS", "MOUNTS", "ACCESSORIES", "SOFTWARE"]
                    },
                    "tags": {
                        "type": "ARRAY",
                        "items": {"type": "STRING"},
                        "description": "Lista de hasta 6 palabras clave específicas del equipamiento (incluyendo obligatoriamente la marca como ZWO, Pegasus, Sky-Watcher, Celestron, etc. y el tipo de producto como Refractor, CMOS, EQ, Filtro, ASIAIR)."
                    }
                },
                "required": ["relevant", "title_es", "title_en", "summary_es", "summary_en", "category_es", "category_en", "tags"]
            }
        }
    }
    
    headers = {'Content-Type': 'application/json'}
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    
    import time
    max_retries = 3
    retry_delay = 6.0
    
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, context=ssl_context) as response:
                res_data = json.loads(response.read().decode('utf-8'))
                
            text_response = res_data['candidates'][0]['content']['parts'][0]['text']
            gemini_result = json.loads(text_response)
            
            # Check relevance
            if not gemini_result.get('relevant', False):
                print(f"Skipping off-topic resource: '{item['title']}' is not related to astrophotography equipment.")
                return {"skipped": True}
                
            processed_item = {
                "id": item['url'],
                "title_es": gemini_result['title_es'],
                "title_en": gemini_result['title_en'],
                "summary_es": gemini_result['summary_es'],
                "summary_en": gemini_result['summary_en'],
                "category_es": gemini_result['category_es'],
                "category_en": gemini_result['category_en'],
                "date": item['date'],
                "url": item['url'],
                "tags": gemini_result['tags']
            }
            return processed_item
            
        except urllib.error.HTTPError as he:
            if he.code in [429, 503, 504] and attempt < max_retries - 1:
                print(f"Gemini API returned HTTP {he.code}. Retrying in {retry_delay}s (Attempt {attempt+1}/{max_retries})...")
                time.sleep(retry_delay)
                retry_delay *= 2  # Exponential backoff
            else:
                print(f"Error calling Gemini API for '{item['title']}': {he}")
                return None
        except Exception as e:
            print(f"Error calling Gemini API for '{item['title']}': {e}")
            return None

def clean_json_text(text):
    """Cleans markdown code block wraps (like ```json ... ```) from a text response."""
    text = text.strip()
    if text.startswith("```"):
        first_line_end = text.find("\n")
        if first_line_end != -1:
            text = text[first_line_end:].strip()
        else:
            text = text[3:].strip()
    if text.endswith("```"):
        text = text[:-3].strip()
    return text

def process_with_deepseek(item, api_key):
    """Uses the DeepSeek API to translate, summarize, and filter equipment relevance as fallback."""
    url = "https://api.deepseek.com/chat/completions"
    
    system_prompt = """You are an expert astrophotographer and astrophotography equipment specialist.
Analyze the provided resource (video, blog post, or forum topic).
Decide if this resource is directly relevant to astrophotography equipment news, new product announcements, hardware releases, firmware updates, software for capturing (like ASIAIR, N.I.N.A., Pegasus Unity, EKOS/INDI, etc.), or detailed reviews of astrophotography equipment (telescopes, mounts, cameras, filters, focusers, rotators, adapters, observatory gear).

CRITICAL FILTERING AND VALIDATION RULES:
1. STRICTLY REJECT ALL SELF-REFERENCED FORUM/REDDIT POSTS:
   - Reject posts/threads where a user is showing off or sharing their personal equipment purchase, acquisition, or unboxing (e.g., "My new AM5 mount has arrived!", "Look at my new telescope setup", "Unboxing my new camera").
   - Reject posts showcasing user-taken astrophotography images (e.g., "First light with my new camera", "NGC 7000 taken with my new telescope", "Testing my new mount on M31").
   - Reject posts about custom DIY projects, 3D printing custom parts, custom DIY mounts, or personal telescope modifications unless they are commercialized, mass-produced products being launched.
   - Reject posts that are general troubleshooting, support requests, or questions on how to use a product (e.g., "Why is my mount not guiding?", "Help with Seestar polar alignment").
2. ONLY ACCEPT COMMERCIAL RELEASES AND OFFICIAL NEWS:
   - Only accept posts/threads about official new commercial product releases or announcements by manufacturers (e.g., ZWO, Celestron, Pegasus Astro, Sky-Watcher, Askar, Player One, etc.), legitimate product leaks/rumors of upcoming commercial gear, or professional/detailed reviews of newly released commercial gear.
   - A thread/post is valid ONLY if it refers to a brand new commercial product that is being released to the market and discussed/referenced by other sources, NOT a single user's personal DIY build or personal purchase.
3. If the resource violates any rejection rule or does not contain general commercial new product announcement/news/reviews, mark relevant = false.

You MUST respond ONLY with a JSON object matching this schema:
{
  "relevant": boolean,
  "title_es": "A clean, natural Spanish title (translated and adapted, no excessive emojis or YouTube clickbait)",
  "title_en": "A refined, clean title in English",
  "summary_es": "A technical summary in Spanish of 2-3 sentences detailing what this equipment, review, or update is about",
  "summary_en": "A concise technical summary in English of 2-3 sentences",
  "category_es": "TELESCOPIOS" | "CÁMARAS" | "MONTURAS" | "ACCESORIOS" | "SOFTWARE",
  "category_en": "TELESCOPES" | "CAMERAS" | "MOUNTS" | "ACCESSORIES" | "SOFTWARE",
  "tags": ["array of up to 6 specific equipment keywords, including the brand (e.g. ZWO, Pegasus, Sky-Watcher, Celestron) and product type"]
}
Do not include any explanation or markdown formatting (like ```json). Respond with the raw JSON object."""

    body_content = item.get("body_content", "")
    body_prompt = ""
    if body_content:
        body_trimmed = body_content[:1500] + "..." if len(body_content) > 1500 else body_content
        body_prompt = f"\nRelease Notes / Details:\n{body_trimmed}\n"

    user_prompt = f"""Title: "{item['title']}"
Source/Creator: "{item['source']}"
URL: {item['url']}
{body_prompt}"""

    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "response_format": {
            "type": "json_object"
        },
        "stream": False
    }
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {api_key}'
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    
    max_retries = 3
    retry_delay = 4.0
    
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, context=ssl_context, timeout=15) as response:
                res_data = json.loads(response.read().decode('utf-8'))
                
            text_response = res_data['choices'][0]['message']['content'].strip()
            text_response = clean_json_text(text_response)
            deepseek_result = json.loads(text_response)
            
            # Extract keys defensively
            relevant = deepseek_result.get('relevant', False)
            title_es = deepseek_result.get('title_es') or deepseek_result.get('titulo_es') or item['title']
            title_en = deepseek_result.get('title_en') or item['title']
            summary_es = deepseek_result.get('summary_es') or deepseek_result.get('resumen_es') or ""
            summary_en = deepseek_result.get('summary_en') or deepseek_result.get('resumen_en') or ""
            category_es = deepseek_result.get('category_es') or deepseek_result.get('categoria_es') or "ACCESORIOS"
            category_en = deepseek_result.get('category_en') or deepseek_result.get('categoria_en') or "ACCESSORIES"
            tags = deepseek_result.get('tags') or []
            
            # Check relevance
            if not relevant:
                print(f"Skipping off-topic resource (DeepSeek): '{item['title']}' is not related to astrophotography equipment.")
                return {"skipped": True}
                
            processed_item = {
                "id": item['url'],
                "title_es": title_es,
                "title_en": title_en,
                "summary_es": summary_es,
                "summary_en": summary_en,
                "category_es": category_es.upper(),
                "category_en": category_en.upper(),
                "date": item['date'],
                "url": item['url'],
                "tags": tags
            }
            return processed_item
            
        except urllib.error.HTTPError as he:
            if he.code in [429, 503, 504] and attempt < max_retries - 1:
                print(f"DeepSeek API returned HTTP {he.code}. Retrying in {retry_delay}s (Attempt {attempt+1}/{max_retries})...")
                time.sleep(retry_delay)
                retry_delay *= 2
            else:
                print(f"Error calling DeepSeek API for '{item['title']}': {he}")
                return None
        except Exception as e:
            print(f"Error calling DeepSeek API for '{item['title']}': {e}")
            return None


def process_with_groq(item, api_key):
    """Uses the Groq API (Llama 3.1 8B) to translate, summarize, and filter equipment relevance as fallback."""
    url = "https://api.groq.com/openai/v1/chat/completions"
    
    system_prompt = """You are an expert astrophotographer and astrophotography equipment specialist.
Analyze the provided resource (video, blog post, or forum topic).
Decide if this resource is directly relevant to astrophotography equipment news, new product announcements, hardware releases, firmware updates, software for capturing (like ASIAIR, N.I.N.A., Pegasus Unity, EKOS/INDI, etc.), or detailed reviews of astrophotography equipment (telescopes, mounts, cameras, filters, focusers, rotators, adapters, observatory gear).

CRITICAL FILTERING AND VALIDATION RULES:
1. STRICTLY REJECT ALL SELF-REFERENCED FORUM/REDDIT POSTS:
   - Reject posts/threads where a user is showing off or sharing their personal equipment purchase, acquisition, or unboxing (e.g., "My new AM5 mount has arrived!", "Look at my new telescope setup", "Unboxing my new camera").
   - Reject posts showcasing user-taken astrophotography images (e.g., "First light with my new camera", "NGC 7000 taken with my new telescope", "Testing my new mount on M31").
   - Reject posts about custom DIY projects, 3D printing custom parts, custom DIY mounts, or personal telescope modifications unless they are commercialized, mass-produced products being launched.
   - Reject posts that are general troubleshooting, support requests, or questions on how to use a product (e.g., "Why is my mount not guiding?", "Help with Seestar polar alignment").
2. ONLY ACCEPT COMMERCIAL RELEASES AND OFFICIAL NEWS:
   - Only accept posts/threads about official new commercial product releases or announcements by manufacturers (e.g., ZWO, Celestron, Pegasus Astro, Sky-Watcher, Askar, Player One, etc.), legitimate product leaks/rumors of upcoming commercial gear, or professional/detailed reviews of newly released commercial gear.
   - A thread/post is valid ONLY if it refers to a brand new commercial product that is being released to the market and discussed/referenced by other sources, NOT a single user's personal DIY build or personal purchase.
3. If the resource violates any rejection rule or does not contain general commercial new product announcement/news/reviews, mark relevant = false.

You MUST respond ONLY with a JSON object matching this schema:
{
  "relevant": boolean,
  "title_es": "A clean, natural Spanish title (translated and adapted, no excessive emojis or YouTube clickbait)",
  "title_en": "A refined, clean title in English",
  "summary_es": "A technical summary in Spanish of 2-3 sentences detailing what this equipment, review, or update is about",
  "summary_en": "A concise technical summary in English of 2-3 sentences",
  "category_es": "TELESCOPIOS" | "CÁMARAS" | "MONTURAS" | "ACCESORIOS" | "SOFTWARE",
  "category_en": "TELESCOPES" | "CAMERAS" | "MOUNTS" | "ACCESSORIES" | "SOFTWARE",
  "tags": ["array of up to 6 specific equipment keywords, including the brand (e.g. ZWO, Pegasus, Sky-Watcher, Celestron) and product type"]
}
Do not include any explanation or markdown formatting (like ```json). Respond with the raw JSON object."""

    body_content = item.get("body_content", "")
    body_prompt = ""
    if body_content:
        body_trimmed = body_content[:1500] + "..." if len(body_content) > 1500 else body_content
        body_prompt = f"\nRelease Notes / Details:\n{body_trimmed}\n"

    user_prompt = f"""Title: "{item['title']}"
Source/Creator: "{item['source']}"
URL: {item['url']}
{body_prompt}"""

    payload = {
        "model": "llama-3.1-8b-instant",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "response_format": {
            "type": "json_object"
        },
        "stream": False
    }
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {api_key}'
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    
    max_retries = 3
    retry_delay = 4.0
    
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, context=ssl_context, timeout=15) as response:
                res_data = json.loads(response.read().decode('utf-8'))
                
            text_response = res_data['choices'][0]['message']['content'].strip()
            text_response = clean_json_text(text_response)
            groq_result = json.loads(text_response)
            
            # Extract keys defensively
            relevant = groq_result.get('relevant', False)
            title_es = groq_result.get('title_es') or groq_result.get('titulo_es') or item['title']
            title_en = groq_result.get('title_en') or item['title']
            summary_es = groq_result.get('summary_es') or groq_result.get('resumen_es') or ""
            summary_en = groq_result.get('summary_en') or groq_result.get('resumen_en') or ""
            category_es = groq_result.get('category_es') or groq_result.get('categoria_es') or "ACCESORIOS"
            category_en = groq_result.get('category_en') or groq_result.get('categoria_en') or "ACCESSORIES"
            tags = groq_result.get('tags') or []
            
            # Check relevance
            if not relevant:
                print(f"Skipping off-topic resource (Groq): '{item['title']}' is not related to astrophotography equipment.")
                return {"skipped": True}
                
            processed_item = {
                "id": item['url'],
                "title_es": title_es,
                "title_en": title_en,
                "summary_es": summary_es,
                "summary_en": summary_en,
                "category_es": category_es.upper(),
                "category_en": category_en.upper(),
                "date": item['date'],
                "url": item['url'],
                "tags": tags
            }
            return processed_item
            
        except urllib.error.HTTPError as he:
            if he.code in [429, 503, 504] and attempt < max_retries - 1:
                print(f"Groq API returned HTTP {he.code}. Retrying in {retry_delay}s (Attempt {attempt+1}/{max_retries})...")
                time.sleep(retry_delay)
                retry_delay *= 2
            else:
                print(f"Error calling Groq API for '{item['title']}': {he}")
                return None
        except Exception as e:
            print(f"Error calling Groq API for '{item['title']}': {e}")
            return None


# Load manufacturers and keywords from JSON files if available
TOOLS_DIR = os.path.dirname(__file__)
FABRICANTES_FILE = os.path.join(TOOLS_DIR, "fabricantes.json")
PALABRAS_CLAVE_FILE = os.path.join(TOOLS_DIR, "palabras_clave.json")

FABRICANTES = []
PALABRAS_CLAVE = []

if os.path.exists(FABRICANTES_FILE):
    try:
        with open(FABRICANTES_FILE, 'r', encoding='utf-8') as f:
            FABRICANTES = json.load(f)
    except Exception as e:
        print(f"Error loading fabricantes.json: {e}")

if os.path.exists(PALABRAS_CLAVE_FILE):
    try:
        with open(PALABRAS_CLAVE_FILE, 'r', encoding='utf-8') as f:
            keywords_data = json.load(f)
            PALABRAS_CLAVE = keywords_data.get("es", []) + keywords_data.get("en", [])
    except Exception as e:
        print(f"Error loading palabras_clave.json: {e}")

# Fallback hardcoded lists if files are missing or empty
if not FABRICANTES:
    FABRICANTES = [
        "ZWO", "Pegasus Astro", "Player One", "PrimaLuceLab", "Planewave", 
        "William Optics", "Celestron", "Sky-Watcher", "Skywatcher", "Explore Scientific", 
        "Lunt Solar Systems", "Askar", "Sharpstar", "Svbony", "QHY", "Meade", 
        "Orion", "Vixen", "Takahashi", "Bresser", "Dwarflab", "MLAstro", "Touptek", "ToupTek"
    ]

if not PALABRAS_CLAVE:
    PALABRAS_CLAVE = [
        "telescope", "refractor", "newtonian", "mount", "camera", "filter", "sensor", 
        "optics", "software", "firmware", "nina", "asiair", "indi", "ekos", "focuser", 
        "rotator", "flattener", "reducer", "guiding", "guide scope", "review", 
        "unboxing", "setup", "seestar", "vespera", "stellina", "accessory", "accessories",
        "firecapture", "sharpcap", "autostakkert", "pixinsight"
    ]

def check_relevance_fallback(title):
    """Rule-based relevance filter for equipment updates using manufacturers and keywords."""
    title_lower = title.lower()
    
    # 1. Match brand names
    for brand in FABRICANTES:
        brand_lower = brand.lower()
        if len(brand_lower) <= 3:
            if re.search(r'\b' + re.escape(brand_lower) + r'\b', title_lower):
                return True
        elif brand_lower in title_lower:
            return True
            
    # 2. Match keywords
    for keyword in PALABRAS_CLAVE:
        keyword_lower = keyword.lower()
        if keyword_lower.startswith('*'):
            term = keyword_lower[1:]
            if term in title_lower:
                return True
        elif len(keyword_lower) <= 4:
            if re.search(r'\b' + re.escape(keyword_lower) + r'\b', title_lower):
                return True
        elif keyword_lower in title_lower:
            return True
            
    return False

def check_forum_relevance(title):
    """Strict pre-filter for forum and Reddit posts to focus on new product announcements."""
    title_lower = title.lower()
    
    # 1. Must contain a product or brand keyword
    product_keywords = ["telescope", "telescopio", "mount", "montura", "camera", "cámara", "filter", "filtro", "focuser", "enfocador", "rotator", "rotador", "strainwave", "harmonic", "harmónico", "refractor", "eyepiece", "ocular"]
    brand_keywords = [b.lower() for b in FABRICANTES]
    
    has_product_or_brand = any(k in title_lower for k in product_keywords) or any(b in title_lower for b in brand_keywords)
    if not has_product_or_brand:
        return False
        
    # 2. Must contain a 'new product' indicating keyword
    new_keywords = ["new", "nuevo", "nueva", "release", "released", "lanzamiento", "lanzado", "announce", "announced", "anuncio", "anunciado", "unveil", "unveiled", "presenta", "presentado", "leak", "filtración", "filtrado", "rumor", "launch", "launching", "introducing", "introducción", "pre-order", "pre-venta", "preorder"]
    
    return any(k in title_lower for k in new_keywords)


def process_fallback(item):
    """Fallback processor if API Key is missing or request fails."""
    print(f"Fallback processing for item: {item['title']}")
    
    tags = ["Equipamiento", item['source']]
    title_lower = item['title'].lower()
    
    # 1. Identify brands from our comprehensive list
    for brand in FABRICANTES:
        brand_lower = brand.lower()
        if len(brand_lower) <= 3:
            if re.search(r'\b' + re.escape(brand_lower) + r'\b', title_lower):
                if brand not in tags:
                    tags.append(brand)
        elif brand_lower in title_lower:
            if brand not in tags:
                tags.append(brand)
                
    # 2. Categorize and tag based on keywords
    category_es = "ACCESORIOS"
    category_en = "ACCESSORIES"
    
    # Check for telescopes
    telescope_keywords = ["telescopio", "telescope", "refractor", "reflector", "newtonian", "newtoniano", "dobsonian", "dobson", "schmidt-cassegrain", "maksutov-cassegrain", "ritchey-chretien", "astrograph", "astrografo", "ota", "redcat"]
    if any(k in title_lower for k in telescope_keywords):
        category_es = "TELESCOPIOS"
        category_en = "TELESCOPES"
        tags.append("Telescopio")
        
    # Check for cameras
    camera_keywords = ["camera", "cámara", "sensor", "cmos", "ccd", "mono", "monocroma", "color", "refrigerada", "cooled", "guia", "guide cam"]
    if any(k in title_lower for k in camera_keywords):
        category_es = "CÁMARAS"
        category_en = "CAMERAS"
        tags.append("Cámara")
        
    # Check for mounts
    mount_keywords = ["mount", "montura", "ecuatorial", "alt-az", "goto", "strain wave", "wave", "tracker", "seguidor"]
    if any(k in title_lower for k in mount_keywords):
        category_es = "MONTURAS"
        category_en = "MOUNTS"
        tags.append("Montura")
        
    # Check for software
    software_keywords = ["software", "firmware", "nina", "asiair", "indi", "ekos", "driver", "app", "kstars", "stellarMate", "controlador"]
    if any(k in title_lower for k in software_keywords) or "releases" in item['source'].lower():
        category_es = "SOFTWARE"
        category_en = "SOFTWARE"
        tags.append("Software")
        
    return {
        "id": item['url'],
        "title_es": f"{item['title']} ({item['source']})",
        "title_en": f"{item['title']} ({item['source']})",
        "summary_es": f"Actualización o revisión de equipamiento de {item['source']}: '{item['title']}'.",
        "summary_en": f"Equipment update or review from {item['source']}: '{item['title']}'.",
        "category_es": category_es,
        "category_en": category_en,
        "date": item['date'],
        "url": item['url'],
        "tags": list(dict.fromkeys(tags))[:6] # Unique elements, limit to 6
    }

def extract_known_models(db, source_type=None):
    """Extracts unique model names from the database tags, excluding brands and generic words.
    If source_type is given ("official"/"reviewer"), only counts entries from that origin.
    Entries without an explicit source_type (legacy) are treated as "reviewer"."""
    brands = {b.lower() for b in FABRICANTES} | {
        "touptek", "zwo", "pegasus", "sky-watcher", "skywatcher", "celestron", 
        "william optics", "lunt", "svbony", "qhy", "qhyccd", "player one", 
        "primalucelab", "planewave", "explore scientific", "dwarflab", "askar", 
        "sharpstar", "siril", "stellarium", "phd2", "nina", "indi", "ekos", 
        "kstars", "seestar", "dwarf ii"
    }
    
    # Generic keywords and phrases to exclude from being treated as models
    generic = {
        # Categories and product types (ES/EN)
        "telescopio", "telescope", "cámara", "camera", "montura", "mount", 
        "accesorio", "accessory", "accessories", "software", "firmware", 
        "guiding", "filtro", "filter", "focuser", "rotator", "flattener", 
        "reducer", "eyepiece", "ocular", "oculares", "binocular", "binoculares",
        "binoculars", "prismáticos", "smart telescope", "guide scope",
        "telescopios", "telescopes", "cámaras", "cameras", "monturas", "mounts",
        "accesorios", "smart telescopes", "driver", "drivers", "app", "apps",
        "web app", "web apps", "controller", "controllers", "sensor", "sensors",
        "optics", "óptica", "ópticas", "optical", "mirror", "mirrors",
        "adapter", "adapters", "adaptador", "adaptadores", "kit lens", "lens", "lente",
        
        # General astronomy and astrophotography terms
        "astrophotography", "astrofotografía", "astronomy", "astronomía",
        "deep sky", "deep-sky", "cielo profundo", "planetary", "planetaria",
        "solar", "lunar", "wide-field", "campo amplio", "astroimaging",
        "astrograph", "astrografo", "refractor", "newtonian", "newtoniano",
        "dobsonian", "dobson", "schmidt-cassegrain", "sct", "apo", "apochromatic",
        "apocromático", "triplet", "triplete", "mono", "color", "cooled",
        "enfriada", "infrarrojo", "infrared", "ir", "light pollution",
        "contaminación lumínica", "dark sky", "bortle", "seeing", "guia",
        "guide", "guiado", "autoguiding", "dithering", "polar alignment",
        "alineación", "alignment", "collimation", "colimación", "focusing",
        "focus", "focal", "aperture", "apertura", "focal ratio",
        "vía láctea", "milky way", "moon", "sun", "stars", "star",
        
        # Action, type of resource and content terms
        "review", "unboxing", "setup", "tutorial", "guía", "guide", "tips",
        "tricks", "first look", "first impressions", "primeras impresiones",
        "test", "testing", "comparativa", "comparison", "overview", "leak",
        "rumor", "leak/rumor", "news", "noticias", "anuncio", "announcement",
        "lanzamiento", "launch", "release", "update", "actualización", "diy",
        "modificación", "modification", "cleaning", "limpieza", "build",
        "building", "remote control", "control remoto", "automation",
        "automatización", "observatory", "observatorio", "planning",
        "scheduler", "secuenciador", "sequencer", "software update",
        "firmware update", "processing", "procesamiento", "compatibility",
        "compatibilidad", "troubleshooting", "error", "problem",
        
        # Target audience and general adjectives
        "beginner", "beginners", "principiante", "principiantes", "first",
        "primero", "primer", "best", "mejor", "mejores", "top", "budget",
        "cheap", "barato", "expensive", "premium", "pro", "professional",
        "profesional", "affordable", "new", "nuevo", "nueva", "latest",
        "último", "actual", "modern", "moderno", "portable", "compact",
        "compacto", "innovación", "innovation", "tech", "technology",
        
        # Miscellaneous words found in tags
        "actualización", "astrofotografía ir", "astrografía", "astroimaging software",
        "astronomy apps", "astronomy camera", "astronomy forecast", "astronómica",
        "astrophotografía", "astrophotography camera", "astrophotography mount",
        "astrophotography software", "astrophotography tips", "guiding kit",
        "mirror cleaning", "monocromática", "montura altazimutal",
        "observation", "observación", "observación astronómica", "observación solar",
        "observatory setup", "observatory system", "observing planner",
        "optical accessories", "outdoor setup", "photometry", "primer telescopio",
        "radio telescope software", "recommendations", "remote system",
        "revisión", "revisión equipamiento", "software update", "solar camera",
        "solar telescope", "telescope accessory", "telescope automation",
        "telescope control", "telescope enclosure", "telescope mirror",
        "telescope mount", "telescope review", "telescope selection",
        "telescope tube", "telescope upgrades", "telescopio apocromático",
        "telescopio solar", "visual telescope", "weatherproof", "web app",
        "wide-field astrophotography", "equipment comparison", "equipo",
        "new product", "novedad", "novedades", "nuevo producto", "reddit",
        "stargazers lounge", "pixinsight"
    }
    
    known_models = set()
    for entry in db:
        if source_type is not None and entry.get("source_type", "reviewer") != source_type:
            continue
        for tag in entry.get("tags", []):
            tag_clean = tag.strip().lower()
            # Exclude brand names, generic words, or tags that are empty/too short
            if tag_clean and len(tag_clean) > 2 and tag_clean not in brands and tag_clean not in generic:
                known_models.add(tag_clean)
                
    return known_models


def is_duplicate_product_introduction(title, known_models):
    """
    Checks if a candidate title contains a known model name AND introductory keywords
    indicating it is a duplicate introduction/unboxing/presentation.
    """
    title_lower = title.lower()
    
    # Normalize a string by removing spaces and non-alphanumeric characters
    def normalize_str(s):
        return re.sub(r'[^a-z0-9]', '', s)
        
    title_normalized = normalize_str(title_lower)
    
    matched_model = None
    for model in known_models:
        model_normalized = normalize_str(model)
        if not model_normalized:
            continue
        # If the model is a short code (e.g. 3 chars like 'am5'), matching it as a substring of normalized title might be risky
        # but since 'am5' would be in 'zwoam5mount', it works. Let's make sure it is not too short.
        if len(model_normalized) <= 3:
            if re.search(r'\b' + re.escape(model) + r'\b', title_lower):
                matched_model = model
                break
        else:
            if model_normalized in title_normalized:
                matched_model = model
                break
                
    if not matched_model:
        return False, None
        
    introductory_keywords = [
        "presentando", "presentacion", "presentación", "presenta", "presentamos", 
        "introducing", "introduction", "introduces", "unveiling", "first look", 
        "first impression", "primeras impresiones", "unboxing", "lanzamiento", "launch", 
        "anuncio de", "announcing", "anunciando", "new product", "nuevo producto"
    ]
    
    for keyword in introductory_keywords:
        if keyword in title_lower:
            return True, matched_model
            
    return False, None

def regenerate_markdown_catalog(db):
    """Regenerates the markdown product catalog from the database entries."""
    catalog_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "catalogo_productos.md")
    
    # 1. Map brands dynamically
    brands_lower = {b.lower(): b for b in FABRICANTES}
    extra_brands = {
        "touptek": "ToupTek",
        "zwo": "ZWO",
        "pegasus": "Pegasus Astro",
        "celestron": "Celestron",
        "sky-watcher": "Sky-Watcher",
        "skywatcher": "Sky-Watcher",
        "william optics": "William Optics",
        "askar": "Askar",
        "sharpstar": "Sharpstar",
        "svbony": "Svbony",
        "qhy": "QHYCCD",
        "player one": "Player One Astronomy",
        "primalucelab": "PrimaLuceLab",
        "planewave": "Planewave",
        "explore scientific": "Explore Scientific",
        "lunt": "Lunt Solar Systems",
        "dwarflab": "Dwarflab",
        "vespera": "Vaonis",
        "stellina": "Vaonis",
        "seestar": "ZWO",
        "dwarf ii": "Dwarflab",
        "siril": "Siril",
        "stellarium": "Stellarium",
        "phd2": "PHD2 Guiding",
        "nina": "N.I.N.A.",
        "indi": "INDI Library",
        "ekos": "Ekos",
        "kstars": "KStars"
    }
    for k, v in extra_brands.items():
        if k not in brands_lower:
            brands_lower[k] = v

    known_models = extract_known_models(db)
    
    # Group products by manufacturer and category
    grouped = {}
    for entry in db:
        mfg = None
        tags = [t.strip() for t in entry.get("tags", [])]
        
        for tag in tags:
            tag_lower = tag.lower()
            if tag_lower in brands_lower:
                mfg = brands_lower[tag_lower]
                break
                
        if not mfg:
            title_lower = entry.get("title_en", "").lower()
            for b_low, b_name in brands_lower.items():
                if b_low in title_lower:
                    mfg = b_name
                    break
                    
        if not mfg:
            mfg = "Otros / No especificado"
            
        category = entry.get("category_en", "ACCESSORIES")
        
        model = None
        for tag in tags:
            tag_lower = tag.lower()
            if tag_lower in known_models:
                model = tag
                break
                
        if not model:
            model = "General / No especificado"
            
        if mfg not in grouped:
            grouped[mfg] = {}
        if category not in grouped[mfg]:
            grouped[mfg][category] = {}
        if model not in grouped[mfg][category]:
            grouped[mfg][category][model] = []
            
        grouped[mfg][category][model].append({
            "title": entry.get("title_es", entry.get("title_en", "")),
            "date": entry.get("date", ""),
            "url": entry.get("url", "")
        })
        
    md_content = """# Catálogo de Equipamiento por Fabricante

Este documento contiene la lista de todos los productos de astrofotografía y hardware identificados en la base de datos de CabraSpace (`equipamiento.json`) agrupados por fabricante y categoría. Se regenera automáticamente cada vez que se ejecuta el scraper.

---
"""
    
    for mfg in sorted(grouped.keys()):
        if mfg == "Otros / No especificado" and len(grouped[mfg]) == 0:
            continue
        md_content += f"\n## {mfg}\n"
        for category in sorted(grouped[mfg].keys()):
            md_content += f"\n### {category}\n"
            for model in sorted(grouped[mfg][category].keys()):
                if model == "General / No especificado":
                    md_content += f"- **Actualizaciones Generales / Revisiones:**\n"
                else:
                    md_content += f"- **Modelo: {model}**\n"
                for item in grouped[mfg][category][model]:
                    md_content += f"  - [{item['title']}]({item['url']}) ({item['date']})\n"
                    
    try:
        with open(catalog_path, "w", encoding="utf-8") as f:
            f.write(md_content)
        print(f"Successfully updated markdown catalog at {catalog_path}")
    except Exception as e:
        print(f"Error writing markdown catalog: {e}")

def main():
    print("Starting Astrophotography Equipment News Scraper...")
    gemini_key = os.environ.get("GEMINI_API_KEY")
    groq_key = os.environ.get("GROQ_API_KEY")
    deepseek_key = os.environ.get("DEEPSEEK_API_KEY")
    
    is_dry_run = False
    if not gemini_key and not groq_key and not deepseek_key:
        print("Warning: Neither GEMINI_API_KEY, GROQ_API_KEY nor DEEPSEEK_API_KEY environment variables found. Running in fallback dry-run mode (database will not be modified).")
        is_dry_run = True
        
    db = load_database()
    existing_ids = {entry['id'] for entry in db}
    known_models = extract_known_models(db)
    known_models_official = extract_known_models(db, source_type="official")
    print(f"Extracted {len(known_models)} known product models from database tags ({len(known_models_official)} already covered by official sources).")
    
    # Gather candidates from all feeds
    candidates = []
    for source in SOURCES:
        print(f"Fetching from: {source['name']}...")
        items = fetch_feed_items(source)
        print(f"Fetched {len(items)} items from {source['name']}.")
        candidates.extend(items)
        
    # Gather software releases from GitHub
    print("\nFetching software releases from GitHub...")
    for repo_info in GITHUB_REPOS:
        print(f"Checking GitHub: {repo_info['name']}...")
        release_item = fetch_github_release(repo_info)
        if release_item:
            print(f"Found release for {repo_info['name']}: {release_item['title']}")
            candidates.append(release_item)
            
    # Gather software releases from GitLab
    print("\nFetching software releases from GitLab...")
    for repo_info in GITLAB_REPOS:
        print(f"Checking GitLab: {repo_info['name']}...")
        release_item = fetch_gitlab_release(repo_info)
        if release_item:
            print(f"Found release for {repo_info['name']}: {release_item['title']}")
            candidates.append(release_item)
        
    # Sort all candidates by date (newest first)
    candidates.sort(key=lambda x: x['date'], reverse=True)
    
    # Filter out duplicates and items older than 3 days (both against existing database and within the current run candidates)
    current_date = datetime.now()
    seen_urls_this_run = set()
    new_candidates = []
    for c in candidates:
        if c['url'] in existing_ids or c['url'] in seen_urls_this_run:
            continue
        try:
            item_date = datetime.strptime(c['date'], "%Y-%m-%d")
            days_diff = (current_date - item_date).days
            # Ventana más amplia para canales oficiales: publican con menos frecuencia y no
            # queremos que un anuncio del fabricante caduque mientras sí entran reviews posteriores.
            max_age = MFG_MAX_AGE_DAYS if c.get('is_mfg', False) else OTHER_MAX_AGE_DAYS
            if days_diff <= max_age:
                new_candidates.append(c)
                seen_urls_this_run.add(c['url'])
        except Exception:
            new_candidates.append(c)
            seen_urls_this_run.add(c['url'])
            
    # Partition into manufacturers/official releases vs others to avoid starvation of vendor updates
    new_mfg_candidates = [c for c in new_candidates if c.get('is_mfg', False)]
    new_other_candidates = [c for c in new_candidates if not c.get('is_mfg', False)]
    new_candidates = new_mfg_candidates + new_other_candidates
    
    print(f"Total compiled candidates: {len(candidates)}, Unique new candidates: {len(new_candidates)} (Manufacturers/Official: {len(new_mfg_candidates)}, Others: {len(new_other_candidates)})")
    
    if not new_candidates:
        print("No new updates. Database is up to date.")
        return
        
    processed_count = 0
    other_count = 0
    updates_to_add = []

    gemini_disabled = False
    groq_disabled = False

    for item in new_candidates:
        if processed_count >= MAX_ITEMS_TO_PROCESS:
            print("Reached processing limit for this run.")
            break

        # Check if candidate is from a manufacturer feed
        is_mfg = item.get('is_mfg', False)
        is_forum = item['source'] in ["Stargazers Lounge", "Reddit r/astrophotography", "Reddit r/telescopes"]

        # Reserva de capacidad: limita cuántos items de terceros se procesan por run para que
        # los canales oficiales (procesados primero por el orden mfg-first) no se queden sin slots.
        if not is_mfg and other_count >= MAX_OTHER_ITEMS:
            print(f"Skipping third-party item (official quota reserved, {other_count}/{MAX_OTHER_ITEMS} used): '{item['title']}' from {item['source']}")
            continue

        # Deduplicación consciente del origen: un anuncio OFICIAL solo se descarta si el modelo ya
        # lo cubre OTRA fuente oficial — no si solo aparecía en un reviewer (así el oficial puede
        # 'rellenar' ese modelo). Un item de TERCEROS se descarta si el modelo ya lo cubre cualquiera.
        dedup_set = known_models_official if is_mfg else known_models

        # Pre-filter candidates using keyword check to save Gemini API quota and avoid rate limits
        if is_forum:
            if not check_forum_relevance(item['title']):
                print(f"Skipping off-topic forum candidate (pre-filtered): '{item['title']}' from {item['source']}")
                continue
        elif not is_mfg:
            if not check_relevance_fallback(item['title']):
                print(f"Skipping off-topic candidate (pre-filtered): '{item['title']}' from {item['source']}")
                continue

        # Check if candidate is a duplicate product introduction
        is_dup, matched_m = is_duplicate_product_introduction(item['title'], dedup_set)
        if is_dup:
            print(f"Skipping duplicate product introduction (pre-filtered): '{item['title']}' matches known model '{matched_m}'")
            continue
            
        print(f"\nProcessing new candidate: '{item['title']}' from {item['source']} ({item['date']})")
        processed_item = None
        
        # 1. Try Gemini first if not disabled
        if gemini_key and not gemini_disabled:
            import time
            print("Sleeping 6.0s to respect Gemini API rate limits...")
            time.sleep(6.0)
            # Let Gemini process and check relevance
            processed_item = process_with_gemini(item, gemini_key)
            
            # If Gemini successfully determined that the item is NOT relevant
            if processed_item and processed_item.get("skipped"):
                print(f"Gemini classified item as not relevant. Skipping.")
                continue
                
            # If Gemini failed (returned None), disable it for the rest of the run
            if processed_item is None:
                print("Gemini failed with a persistent error or rate limit. Disabling Gemini for this run.")
                gemini_disabled = True
        
        # 2. Try Groq if Gemini failed or was not tried
        if processed_item is None and groq_key and not groq_disabled:
            print("Trying Groq API (Llama 3.1 8B)...")
            processed_item = process_with_groq(item, groq_key)
            
            if processed_item and processed_item.get("skipped"):
                print(f"Groq classified item as not relevant. Skipping.")
                continue
                
            if processed_item is None:
                print("Groq failed. Disabling Groq for this run.")
                groq_disabled = True

        # 3. Try DeepSeek if Gemini and Groq failed or were not tried
        if processed_item is None and deepseek_key:
            print("Trying DeepSeek API...")
            processed_item = process_with_deepseek(item, deepseek_key)
            
            if processed_item and processed_item.get("skipped"):
                print(f"DeepSeek classified item as not relevant. Skipping.")
                continue
                
            if processed_item is None:
                print("DeepSeek failed as well.")
                
        # 4. Fallback to local heuristic parsing if all APIs were tried and failed, or none are configured
        if processed_item is None:
            processed_item = process_fallback(item)
            
        if processed_item:
            # Post-filter check: identify candidate model tags and verify if they are a subset of known models
            candidate_models = set()
            brands = {b.lower() for b in FABRICANTES} | {
                "touptek", "zwo", "pegasus", "sky-watcher", "skywatcher", "celestron", 
                "william optics", "lunt", "svbony", "qhy", "qhyccd", "player one", 
                "primalucelab", "planewave", "explore scientific", "dwarflab", "askar", 
                "sharpstar", "siril", "stellarium", "phd2", "nina", "indi", "ekos", 
                "kstars", "seestar", "dwarf ii"
            }
            generic = {
                "telescopio", "telescope", "cámara", "camera", "montura", "mount", 
                "accesorio", "accessory", "accessories", "software", "firmware", 
                "guiding", "filtro", "filter", "focuser", "rotator", "flattener", 
                "reducer", "eyepiece", "ocular", "oculares", "binocular", "binoculares",
                "binoculars", "prismáticos", "smart telescope", "guide scope",
                "telescopios", "telescopes", "cámaras", "cameras", "monturas", "mounts",
                "accesorios", "smart telescopes", "driver", "drivers", "app", "apps",
                "web app", "web apps", "controller", "controllers", "sensor", "sensors",
                "optics", "óptica", "ópticas", "optical", "mirror", "mirrors",
                "adapter", "adapters", "adaptador", "adaptadores", "kit lens", "lens", "lente",
                "astrophotography", "astrofotografía", "astronomy", "astronomía",
                "deep sky", "deep-sky", "cielo profundo", "planetary", "planetaria",
                "solar", "lunar", "wide-field", "campo amplio", "astroimaging",
                "astrograph", "astrografo", "refractor", "newtonian", "newtoniano",
                "dobsonian", "dobson", "schmidt-cassegrain", "sct", "apo", "apochromatic",
                "apocromático", "triplet", "triplete", "mono", "color", "cooled",
                "enfriada", "infrarrojo", "infrared", "ir", "light pollution",
                "contaminación lumínica", "dark sky", "bortle", "seeing", "guia",
                "guide", "guiado", "autoguiding", "dithering", "polar alignment",
                "alineación", "alignment", "collimation", "colimación", "focusing",
                "focus", "focal", "aperture", "apertura", "focal ratio",
                "vía láctea", "milky way", "moon", "sun", "stars", "star",
                "review", "unboxing", "setup", "tutorial", "guía", "guide", "tips",
                "tricks", "first look", "first impressions", "primeras impresiones",
                "test", "testing", "comparativa", "comparison", "overview", "leak",
                "rumor", "leak/rumor", "news", "noticias", "anuncio", "announcement",
                "lanzamiento", "launch", "release", "update", "actualización", "diy",
                "modificación", "modification", "cleaning", "limpieza", "build",
                "building", "remote control", "control remoto", "automation",
                "automatización", "observatory", "observatorio", "planning",
                "scheduler", "secuenciador", "sequencer", "software update",
                "firmware update", "processing", "procesamiento", "compatibility",
                "compatibilidad", "troubleshooting", "error", "problem",
                "beginner", "beginners", "principiante", "principiantes", "first",
                "primero", "primer", "best", "mejor", "mejores", "top", "budget",
                "cheap", "barato", "expensive", "premium", "pro", "professional",
                "profesional", "affordable", "new", "nuevo", "nueva", "latest",
                "último", "actual", "modern", "moderno", "portable", "compact",
                "compacto", "innovación", "innovation", "tech", "technology",
                "actualización", "astrofotografía ir", "astrografía", "astroimaging software",
                "astronomy apps", "astronomy camera", "astronomy forecast", "astronómica",
                "astrophotografía", "astrophotography camera", "astrophotography mount",
                "astrophotography software", "astrophotography tips", "guiding kit",
                "mirror cleaning", "monocromática", "montura altazimutal",
                "observation", "observación", "observación astronómica", "observación solar",
                "observatory setup", "observatory system", "observing planner",
                "optical accessories", "outdoor setup", "photometry", "primer telescopio",
                "radio telescope software", "recommendations", "remote system",
                "revisión", "revisión equipamiento", "software update", "solar camera",
                "solar telescope", "telescope accessory", "telescope automation",
                "telescope control", "telescope enclosure", "telescope mirror",
                "telescope mount", "telescope review", "telescope selection",
                "telescope tube", "telescope upgrades", "telescopio apocromático",
                "telescopio solar", "visual telescope", "weatherproof", "web app",
                "wide-field astrophotography", "equipment comparison", "equipo",
                "new product", "novedad", "novedades", "nuevo producto", "reddit",
                "stargazers lounge", "pixinsight"
            }
            
            for tag in processed_item.get('tags', []):
                tag_clean = tag.strip().lower()
                if tag_clean and len(tag_clean) > 2 and tag_clean not in brands and tag_clean not in generic:
                    candidate_models.add(tag_clean)
                    
            # If the candidate has product model tags, check if they are all already known
            if candidate_models:
                if candidate_models.issubset(dedup_set):
                    # Check if it's a software/firmware update
                    software_keywords = ["firmware", "software", "driver", "controlador", "update", "actualización", "version", "versión", "release"]
                    title_lower = processed_item['title_en'].lower()
                    is_software = processed_item['category_en'] == "SOFTWARE" or any(k in title_lower for k in software_keywords)
                    
                    if not is_software:
                        print(f"Skipping duplicate product entry (post-filtered): '{processed_item['title_en']}' only references known models {candidate_models}")
                        continue
                
            # Marca el origen para la deduplicación futura (preferencia oficial sobre reviewer).
            processed_item['source_type'] = "official" if is_mfg else "reviewer"
            processed_item['source'] = item['source']
            updates_to_add.append(processed_item)
            processed_count += 1
            if not is_mfg:
                other_count += 1

    if updates_to_add:
        # Prepend new updates
        db = updates_to_add + db
        # Trim database if it exceeds max size
        if len(db) > MAX_DB_SIZE:
            db = db[:MAX_DB_SIZE]
        
        if not is_dry_run:
            save_database(db)
            print(f"Successfully added {processed_count} new entries to equipamiento.json")
            regenerate_markdown_catalog(db)
        else:
            print(f"[DRY-RUN] Found {processed_count} new entries, but database was not modified.")
    else:
        print("No new relevant updates added in this run.")
        if not is_dry_run:
            regenerate_markdown_catalog(db)

if __name__ == "__main__":
    main()
