import os
import json
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime
import re
import sys
import ssl

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
DB_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "novedades.json")
MAX_ITEMS_TO_PROCESS = 12  # Process max 12 new items per run
MAX_DB_SIZE = 100         # Keep DB file size light

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
                    "is_youtube": True
                })
    except Exception as e:
        print(f"Error loading creadores.json: {e}")

# Fallback default list if json file is missing
if not YOUTUBE_SOURCES:
    YOUTUBE_SOURCES = [
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
        {"name": "Ed Ting", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCEQnX-WohTBNGBV5gdhAS5w", "is_youtube": True},
        {"name": "Dylan O'Donnell", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCgOf4wBnoGg8WHHHr_h4otQ", "is_youtube": True},
        {"name": "Astrobackyard", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCn3npsPixgoi_xLdCg9J-LQ", "is_youtube": True}
    ]

# Scraping Sources
SOURCES = [
    # Official Forum Announcements
    {"name": "PixInsight Forum", "url": "https://pixinsight.com/forum/index.php?forums/announcements.10/index.rss", "is_youtube": False},
    # Reddit Communities
    {"name": "Reddit r/pixinsight", "url": "https://www.reddit.com/r/pixinsight/new/.rss", "is_youtube": False}
] + YOUTUBE_SOURCES

def fetch_feed_items(source_info):
    """Fetches and parses items from a single RSS or Atom feed."""
    url = source_info["url"]
    is_youtube = source_info["is_youtube"]
    
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, context=ssl_context) as response:
            xml_data = response.read()
            
        root = ET.fromstring(xml_data)
        tag_name = root.tag
        results = []
        
        # Atom XML Feed (YouTube Feeds)
        if "feed" in tag_name.lower():
            ns = {
                'atom': 'http://www.w3.org/2005/Atom',
                'yt': 'http://www.youtube.com/xml/schemas/2015'
            }
            
            entries = root.findall('atom:entry', ns)
            for entry in entries:
                title_el = entry.find('atom:title', ns)
                title = title_el.text.strip() if title_el is not None else ""
                
                link_el = entry.find('atom:link[@rel="alternate"]', ns)
                if link_el is None:
                    link_el = entry.find('atom:link', ns)
                link = link_el.attrib.get('href', '').strip() if link_el is not None else ""
                
                pub_date_el = entry.find('atom:published', ns)
                pub_date_str = pub_date_el.text.strip() if pub_date_el is not None else ""
                
                # Channel title from source_info or parsed XML
                author = source_info["name"]
                
                # Parse: "2026-06-02T15:00:00+00:00" -> "2026-06-02"
                date_formatted = pub_date_str.split('T')[0] if 'T' in pub_date_str else datetime.now().strftime("%Y-%m-%d")
                
                if title and link:
                    results.append({
                        "id": link,
                        "title": title,
                        "url": link,
                        "date": date_formatted,
                        "source": author,
                        "is_youtube": True
                    })
                    
        # RSS 2.0 Feed (XenForo Announcements)
        else:
            channel = root.find('channel')
            if channel is not None:
                items = channel.findall('item')
                for item in items:
                    title = item.find('title').text.strip() if item.find('title') is not None else ""
                    link = item.find('link').text.strip() if item.find('link') is not None else ""
                    pub_date_str = item.find('pubDate').text.strip() if item.find('pubDate') is not None else ""
                    
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
                            "source": "PixInsight Forum",
                            "is_youtube": False
                        })
        return results
    except Exception as e:
        print(f"Error fetching feed '{source_info['name']}': {e}")
        return []

def load_database():
    """Loads the database of updates."""
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
    """Uses the Gemini 2.5 API with responseSchema to translate, summarize, and filter for relevance."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    
    prompt = f"""
    You are an expert astrophotographer and PixInsight specialist.
    Analyze the following astrophotography resource.
    
    Title: "{item['title']}"
    Source/Creator: "{item['source']}"
    URL: {item['url']}
    
    Decide if this resource is directly relevant to PixInsight processing, tutorials, workflows, script updates, or release news.
    *   If it is about general telescope setup, camera sensors, other software (e.g. Photoshop/Siril/N.I.N.A) WITHOUT direct PixInsight context, mark it relevant = false.
    *   If it teaches or details a PixInsight processing technique, tool (like BlurXTerminator, SPCC, GHS), or script, mark relevant = true.
    
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
                        "description": "True if directly relevant to PixInsight software, tutorials, custom scripts, or workflows. False otherwise."
                    },
                    "title_es": {
                        "type": "STRING", 
                        "description": "Título en español limpio y natural (traducido y adaptado, eliminando emojis excesivos o clickbait de YouTube)."
                    },
                    "title_en": {
                        "type": "STRING", 
                        "description": "A refined, clean title in English."
                    },
                    "summary_es": {
                        "type": "STRING", 
                        "description": "Resumen técnico de 2 o 3 frases en español detallando qué enseña este recurso de PixInsight."
                    },
                    "summary_en": {
                        "type": "STRING", 
                        "description": "A concise technical summary in English of 2 to 3 sentences."
                    },
                    "category_es": {
                        "type": "STRING", 
                        "enum": ["SOFTWARE", "SCRIPTS", "TALLERES", "COMUNIDAD"]
                    },
                    "category_en": {
                        "type": "STRING", 
                        "enum": ["SOFTWARE", "SCRIPTS", "WORKSHOPS", "COMMUNITY"]
                    },
                    "tags": {
                        "type": "ARRAY",
                        "items": {"type": "STRING"},
                        "description": "Lista de hasta 6 palabras clave específicas de PixInsight (ej. BlurXTerminator, SPCC, GHS, SHO, LRGB, Tutorial)."
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
            with urllib.request.urlopen(req) as response:
                res_data = json.loads(response.read().decode('utf-8'))
                
            text_response = res_data['candidates'][0]['content']['parts'][0]['text']
            gemini_result = json.loads(text_response)
            
            # Check relevance
            if not gemini_result.get('relevant', False):
                print(f"Skipping off-topic resource: '{item['title']}' is not related to PixInsight.")
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

def check_relevance_fallback(title):
    """Rule-based relevance filter for fallback dry-run mode."""
    keywords = [
        "pixinsight", "workflow", "script", "process", "tutorial", 
        "bxt", "sxt", "nxt", "blurxterminator", "starxterminator", "noisexterminator",
        "cuda", "spcc", "narrowband", "sho", "hoo", "lrgb", "color calibration", 
        "stretching", "drizzle", "subframe", "ghs", "gradient", "deconvolution",
        "processing", "editing", "masters of"
    ]
    title_lower = title.lower()
    
    # Strip common non-indicative hashtags like #shorts and #short first
    title_clean = title_lower.replace("#shorts", "").replace("#short", "")
    
    for k in keywords:
        # Enforce word boundaries for very short keywords (<= 4 chars) to avoid false positives like #shorts matching sho
        if len(k) <= 4:
            if re.search(r'\b' + re.escape(k) + r'\b', title_clean):
                return True
        else:
            if k in title_clean:
                return True
                
    return False

def process_with_deepseek(item, api_key):
    """Uses the DeepSeek API to translate, summarize, and filter for relevance as fallback."""
    url = "https://api.deepseek.com/chat/completions"
    
    system_prompt = """You are an expert astrophotographer and PixInsight specialist.
Analyze the provided astrophotography resource.
Decide if this resource is directly relevant to PixInsight processing, tutorials, workflows, script updates, or release news.
- If it is about general telescope setup, camera sensors, or other software (e.g. Photoshop/Siril/N.I.N.A) WITHOUT direct PixInsight context, mark relevant = false.
- If it teaches or details a PixInsight processing technique, tool (like BlurXTerminator, SPCC, GHS), or script, mark relevant = true.

You MUST respond ONLY with a JSON object matching this schema:
{
  "relevant": boolean,
  "title_es": "A clean, natural Spanish title (translated and adapted, no excessive emojis or YouTube clickbait)",
  "title_en": "A refined, clean title in English",
  "summary_es": "A technical summary in Spanish of 2-3 sentences detailing what this PixInsight resource teaches",
  "summary_en": "A concise technical summary in English of 2-3 sentences",
  "category_es": "SOFTWARE" | "SCRIPTS" | "TALLERES" | "COMUNIDAD",
  "category_en": "SOFTWARE" | "SCRIPTS" | "WORKSHOPS" | "COMMUNITY",
  "tags": ["array of up to 6 specific PixInsight keywords, e.g., BlurXTerminator, SPCC, GHS, SHO, LRGB, Tutorial"]
}
Do not include any explanation or markdown formatting (like ```json). Respond with the raw JSON object."""

    user_prompt = f"""Title: "{item['title']}"
Source/Creator: "{item['source']}"
URL: {item['url']}"""

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
            print(f"Skipping off-topic resource (DeepSeek): '{item['title']}' is not related to PixInsight.")
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


def process_fallback(item):
    """Fallback processor if API Key is missing or request fails."""
    print(f"Fallback processing for item: {item['title']}")
    
    # Simple tagging based on title keywords
    tags = ["PixInsight", item['source']]
    title_lower = item['title'].lower()
    if "cuda" in title_lower or "gpu" in title_lower:
        tags.extend(["GPU", "CUDA"])
    if "script" in title_lower:
        category_es = "SCRIPTS"
        category_en = "SCRIPTS"
        tags.append("Scripts")
    elif "tutorial" in title_lower or "workflow" in title_lower or "how to" in title_lower:
        category_es = "TALLERES"
        category_en = "WORKSHOPS"
        tags.append("Tutorial")
    else:
        category_es = "SOFTWARE"
        category_en = "SOFTWARE"
        
    return {
        "id": item['url'],
        "title_es": f"{item['title']} ({item['source']})",
        "title_en": f"{item['title']} ({item['source']})",
        "summary_es": f"Actualización o tutorial de {item['source']}: '{item['title']}'.",
        "summary_en": f"Update or tutorial from {item['source']}: '{item['title']}'.",
        "category_es": category_es,
        "category_en": category_en,
        "date": item['date'],
        "url": item['url'],
        "tags": tags[:6]
    }

def main():
    print("Starting Expanded PixInsight News Scraper...")
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
        
    # Sort all candidates by date (newest first)
    candidates.sort(key=lambda x: x['date'], reverse=True)
    
    # Filter out duplicates and items older than 3 days
    current_date = datetime.now()
    new_candidates = []
    for c in candidates:
        if c['url'] in existing_ids:
            continue
        try:
            item_date = datetime.strptime(c['date'], "%Y-%m-%d")
            days_diff = (current_date - item_date).days
            if days_diff <= 3:
                new_candidates.append(c)
        except Exception:
            new_candidates.append(c)
            
    print(f"Total compiled candidates: {len(candidates)}, Unique new candidates (<= 3 days): {len(new_candidates)}")
    
    if not new_candidates:
        print("No new updates. Database is up to date.")
        return
        
    processed_count = 0
    updates_to_add = []
    
    for item in new_candidates:
        if processed_count >= MAX_ITEMS_TO_PROCESS:
            print("Reached processing limit for this run.")
            break
            
        # Check if candidate is from a manufacturer/official feed (not YouTube)
        is_official = not item['is_youtube']
        
        # Pre-filter YouTube candidates using keyword check to save Gemini API quota and avoid rate limits
        if not is_official and not check_relevance_fallback(item['title']):
            print(f"Skipping off-topic candidate (pre-filtered): '{item['title']}' from {item['source']}")
            continue
            
        print(f"\nProcessing new candidate: '{item['title']}' from {item['source']} ({item['date']})")
        processed_item = None
        
        # 1. Try Gemini first
        if gemini_key:
            import time
            print("Sleeping 6.0s to respect Gemini API rate limits...")
            time.sleep(6.0)
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
        print(f"Successfully added {processed_count} new entries to novedades.json")
    else:
        print("No new relevant updates added in this run.")

if __name__ == "__main__":
    main()
