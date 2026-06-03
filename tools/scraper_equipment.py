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
MAX_ITEMS_TO_PROCESS = 5  # Process max 5 new items per run to stay within API limits
MAX_DB_SIZE = 150         # Keep DB file size balanced

# Scraping Sources
SOURCES = [
    # Manufacturer Feeds (RSS/Atom)
    {"name": "ZWO", "url": "https://www.zwoastro.com/feed/", "is_youtube": False},
    {"name": "Pegasus Astro", "url": "https://pegasusastro.com/feed/", "is_youtube": False},
    {"name": "Player One Astronomy", "url": "https://player-one-astronomy.com/feed/", "is_youtube": False},
    {"name": "PrimaLuceLab", "url": "https://www.primalucelab.com/blog/feed/", "is_youtube": False},
    {"name": "Planewave", "url": "https://planewave.com/feed/", "is_youtube": False},
    {"name": "William Optics", "url": "https://williamoptics.com/blogs/news.atom", "is_youtube": False},
    {"name": "Celestron", "url": "https://www.celestron.com/blogs/news.atom", "is_youtube": False},
    {"name": "Sky-Watcher USA", "url": "https://www.skywatcherusa.com/blogs/news.atom", "is_youtube": False},
    {"name": "Explore Scientific", "url": "https://explorescientific.com/blogs/news.atom", "is_youtube": False},
    {"name": "Lunt Solar Systems", "url": "https://luntsolarsystems.com/blogs/news.atom", "is_youtube": False},
    {"name": "Stargazers Lounge", "url": "https://stargazerslounge.com/discover/all.xml/", "is_youtube": False},
    {"name": "Reddit r/astrophotography", "url": "https://www.reddit.com/r/astrophotography/new/.rss", "is_youtube": False},
    {"name": "Reddit r/telescopes", "url": "https://www.reddit.com/r/telescopes/new/.rss", "is_youtube": False},
    
    # YouTube Channel Feeds
    {"name": "Adam Block", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCrN82DzPssKUZj2ltFz00VQ", "is_youtube": True},
    {"name": "Cuiv, The Lazy Geek", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCZ5qRydYf3lMJ9A63cvsSEA", "is_youtube": True},
    {"name": "The Space Koala", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCToyE26Iy4-gwi4BowKWClQ", "is_youtube": True},
    {"name": "SetiAstro", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCHeW7wuxfjhMmymXC9KqIbg", "is_youtube": True},
    {"name": "Patriot Astro", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCyf4zn4wd-W4FnBwV98-jXw", "is_youtube": True},
    {"name": "Utah Desert Remote Observatories", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCAP_JNj5koMchEFXnhirwnQ", "is_youtube": True},
    {"name": "Lukomatico", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCBTXZYuFWQ6lx51L4GeY0Lw", "is_youtube": True},
    {"name": "TAIC", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCiR5AmROq4YcXF8hCxxZQ-g", "is_youtube": True},
    {"name": "View into Space", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCW1F7nyBqtNTzaSWcrpx9LQ", "is_youtube": True},
    {"name": "Nebula Photos", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCO_gBdHekc74feh0bWqKJ1Q", "is_youtube": True},
    {"name": "Astro Academy", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC56nUa0BeuHUsE3TM0MCpFg", "is_youtube": True},
    {"name": "Natural Portraits", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCQrYBVmH3Gz9IO5ryXIGhdw", "is_youtube": True},
    {"name": "Astrocitas", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCO7DwcTu__SZs1a65W99SFA", "is_youtube": True},
    {"name": "Astrotivissa", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCIOTjw9A7ckpkCEbdowmV_g", "is_youtube": True},
    {"name": "Naztronomy", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC5L9FO_dFC5ypLPDk1kwopQ", "is_youtube": True},
    {"name": "Astrocity", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCQ-_45PTOmE3ukoWHvmmjoA", "is_youtube": True},
    {"name": "Ed Ting", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCEQnX-WohTBNGBV5gdhAS5w", "is_youtube": True}
]

GITHUB_REPOS = [
    {"name": "N.I.N.A.", "repo": "isbeorn/nina", "category_es": "SOFTWARE", "category_en": "SOFTWARE"},
    {"name": "PHD2 Guiding", "repo": "OpenPHDGuiding/phd2", "category_es": "SOFTWARE", "category_en": "SOFTWARE"},
    {"name": "INDI Library", "repo": "indilib/indi", "category_es": "SOFTWARE", "category_en": "SOFTWARE"},
    {"name": "Stellarium", "repo": "Stellarium/stellarium", "category_es": "SOFTWARE", "category_en": "SOFTWARE"}
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
                        "is_youtube": is_youtube
                    })
                    
        # RSS 2.0 Feed
        else:
            channel = root.find('channel')
            if channel is not None:
                items = channel.findall('item')
                for item in items:
                    title = item.find('title').text.strip() if item.find('title') is not None and item.find('title').text else ""
                    link = item.find('link').text.strip() if item.find('link') is not None and item.find('link').text else ""
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
                            "is_youtube": is_youtube
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
    *   If it is a general photo processing tutorial (e.g. "how to process M31 in Photoshop/PixInsight" without discussing specific equipment setup or gear), or if it is completely off-topic (like landscape photography, space science news, general vlogs), mark relevant = false.
    *   If it is about hardware announcements, firmware releases, software updates for controlling astrophotography gear, or reviews/guides of telescopes, cameras, mounts, accessories (filters, focal reducers, etc.), mark relevant = true.
    
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
        
    except Exception as e:
        print(f"Error calling Gemini API for '{item['title']}': {e}")
        return None

def process_with_deepseek(item, api_key):
    """Uses the DeepSeek API to translate, summarize, and filter equipment relevance as fallback."""
    url = "https://api.deepseek.com/chat/completions"
    
    system_prompt = """You are an expert astrophotographer and astrophotography equipment specialist.
Analyze the provided resource (video, blog post, or forum topic).
Decide if this resource is directly relevant to astrophotography equipment news, new product announcements, hardware releases, firmware updates, software for capturing (like ASIAIR, N.I.N.A., Pegasus Unity, EKOS/INDI, etc.), or detailed reviews of astrophotography equipment (telescopes, mounts, cameras, filters, focusers, rotators, adapters, observatory gear).
- If it is a general photo processing tutorial (e.g. "how to process M31 in Photoshop/PixInsight" without discussing specific equipment setup or gear), or if it is completely off-topic (like landscape photography, space science news, general vlogs), mark relevant = false.
- If it is about hardware announcements, firmware releases, software updates for controlling astrophotography gear, or reviews/guides of telescopes, cameras, mounts, accessories (filters, focal reducers, etc.), mark relevant = true.

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
    
    try:
        # Use 15 seconds timeout
        with urllib.request.urlopen(req, context=ssl_context, timeout=15) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            
        text_response = res_data['choices'][0]['message']['content'].strip()
        deepseek_result = json.loads(text_response)
        
        # Check relevance
        if not deepseek_result.get('relevant', False):
            print(f"Skipping off-topic resource (DeepSeek): '{item['title']}' is not related to astrophotography equipment.")
            return {"skipped": True}
            
        processed_item = {
            "id": item['url'],
            "title_es": deepseek_result['title_es'],
            "title_en": deepseek_result['title_en'],
            "summary_es": deepseek_result['summary_es'],
            "summary_en": deepseek_result['summary_en'],
            "category_es": deepseek_result['category_es'],
            "category_en": deepseek_result['category_en'],
            "date": item['date'],
            "url": item['url'],
            "tags": deepseek_result['tags']
        }
        return processed_item
        
    except Exception as e:
        print(f"Error calling DeepSeek API for '{item['title']}': {e}")
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
        "Orion", "Vixen", "Takahashi", "Bresser", "Dwarflab"
    ]

if not PALABRAS_CLAVE:
    PALABRAS_CLAVE = [
        "telescope", "refractor", "newtonian", "mount", "camera", "filter", "sensor", 
        "optics", "software", "firmware", "nina", "asiair", "indi", "ekos", "focuser", 
        "rotator", "flattener", "reducer", "guiding", "guide scope", "review", 
        "unboxing", "setup", "seestar", "vespera", "stellina", "accessory", "accessories"
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
        "title_es": f"[Auto] {item['title']} ({item['source']})",
        "title_en": f"{item['title']} ({item['source']})",
        "summary_es": f"Actualización o revisión de equipamiento de {item['source']}: '{item['title']}'. Por favor, configure GEMINI_API_KEY en GitHub para habilitar traducciones automáticas.",
        "summary_en": f"Equipment update or review from {item['source']}: '{item['title']}'. Configure GEMINI_API_KEY in GitHub to enable automated AI summaries.",
        "category_es": category_es,
        "category_en": category_en,
        "date": item['date'],
        "url": item['url'],
        "tags": list(dict.fromkeys(tags))[:6] # Unique elements, limit to 6
    }

def main():
    print("Starting Astrophotography Equipment News Scraper...")
    gemini_key = os.environ.get("GEMINI_API_KEY")
    deepseek_key = os.environ.get("DEEPSEEK_API_KEY")
    
    if not gemini_key and not deepseek_key:
        print("Warning: Neither GEMINI_API_KEY nor DEEPSEEK_API_KEY environment variables found. Running in fallback dry-run mode.")
        
    db = load_database()
    existing_ids = {entry['id'] for entry in db}
    
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
    
    # Filter out duplicates
    new_candidates = [c for c in candidates if c['url'] not in existing_ids]
    print(f"Total compiled candidates: {len(candidates)}, Unique new candidates: {len(new_candidates)}")
    
    if not new_candidates:
        print("No new updates. Database is up to date.")
        return
        
    processed_count = 0
    updates_to_add = []
    
    for item in new_candidates:
        if processed_count >= MAX_ITEMS_TO_PROCESS:
            print("Reached processing limit for this run.")
            break
            
        # Check if candidate is from a manufacturer feed (not YouTube and not Stargazers Lounge)
        is_mfg = not item['is_youtube'] and item['source'] != "Stargazers Lounge"
        
        # Pre-filter YouTube and forum candidates using keyword check to save Gemini API quota and avoid rate limits
        if not is_mfg and not check_relevance_fallback(item['title']):
            print(f"Skipping off-topic candidate (pre-filtered): '{item['title']}' from {item['source']}")
            continue
            
        print(f"\nProcessing new candidate: '{item['title']}' from {item['source']} ({item['date']})")
        processed_item = None
        
        # 1. Try Gemini first
        if gemini_key:
            import time
            print("Sleeping 4.5s to respect Gemini API rate limits...")
            time.sleep(4.5)
            # Let Gemini process and check relevance
            processed_item = process_with_gemini(item, gemini_key)
            
            # If Gemini successfully determined that the item is NOT relevant
            if processed_item and processed_item.get("skipped"):
                print(f"Gemini classified item as not relevant. Skipping.")
                continue
                
            # If Gemini failed (returned None), we will try DeepSeek next if key exists
            if processed_item is None:
                print("Gemini failed. Will attempt failover to DeepSeek if key is available...")
        
        # 2. Try DeepSeek if Gemini was not tried, or if Gemini failed
        if processed_item is None and deepseek_key:
            print("Trying DeepSeek API...")
            processed_item = process_with_deepseek(item, deepseek_key)
            
            if processed_item and processed_item.get("skipped"):
                print(f"DeepSeek classified item as not relevant. Skipping.")
                continue
                
            if processed_item is None:
                print("DeepSeek failed as well.")
                
        # 3. Fallback to local heuristic parsing if both APIs were tried and failed, or neither is configured
        if processed_item is None:
            processed_item = process_fallback(item)
            
        if processed_item:
            updates_to_add.append(processed_item)
            processed_count += 1
            
    if updates_to_add:
        # Prepend new updates
        db = updates_to_add + db
        # Trim database if it exceeds max size
        if len(db) > MAX_DB_SIZE:
            db = db[:MAX_DB_SIZE]
        save_database(db)
        print(f"Successfully added {processed_count} new entries to equipamiento.json")
    else:
        print("No new relevant updates added in this run.")

if __name__ == "__main__":
    main()
