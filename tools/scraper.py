import os
import json
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime

# Configuration
RSS_URL = "https://pixinsight.com/forum/index.php?forums/announcements.10/index.rss"
DB_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "novedades.json")
MAX_ITEMS_TO_PROCESS = 3  # Process max 3 new items per run to stay within API limits
MAX_DB_SIZE = 100         # Keep DB file size light

def fetch_rss_items():
    """Fetches items from the PixInsight announcements RSS feed."""
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CabraSpaceNewsAggregator/1.0'}
    req = urllib.request.Request(RSS_URL, headers=headers)
    
    try:
        with urllib.request.urlopen(req) as response:
            xml_data = response.read()
            
        root = ET.fromstring(xml_data)
        channel = root.find('channel')
        items = channel.findall('item')
        
        results = []
        for item in items:
            title = item.find('title').text.strip() if item.find('title') is not None else ""
            link = item.find('link').text.strip() if item.find('link') is not None else ""
            pub_date_str = item.find('pubDate').text.strip() if item.find('pubDate') is not None else ""
            
            # Format date: "Tue, 16 Dec 2025 06:06:20 +0000" -> "2025-12-16"
            try:
                # Truncate timezones like +0000 or GMT for simpler parsing
                clean_date_str = pub_date_str.split(' +')[0].split(' -')[0].strip()
                # Parse: "Tue, 16 Dec 2025 06:06:20"
                dt = datetime.strptime(clean_date_str, "%a, %d %b %Y %H:%M:%S")
                date_formatted = dt.strftime("%Y-%m-%d")
            except Exception:
                date_formatted = datetime.now().strftime("%Y-%m-%d")
                
            if title and link:
                results.append({
                    "id": link,
                    "title": title,
                    "url": link,
                    "date": date_formatted
                })
        return results
    except Exception as e:
        print(f"Error fetching RSS: {e}")
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
    """Uses the Gemini 2.5 API with responseSchema to translate and summarize the item."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    
    prompt = f"""
    You are an expert astrophotographer and PixInsight specialist.
    Analyze the following PixInsight forum announcement.
    Translate it to Spanish, summarize it, categorize it, and provide relevant tags.
    
    Announcement Title: {item['title']}
    Resource URL: {item['url']}
    
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
                    "title_es": {
                        "type": "STRING", 
                        "description": "Título traducido al español. Debe ser claro, atractivo y sonar natural."
                    },
                    "title_en": {
                        "type": "STRING", 
                        "description": "El título original o refinado en inglés."
                    },
                    "summary_es": {
                        "type": "STRING", 
                        "description": "Resumen técnico corto de 2 o 3 frases en español explicando de qué se trata la novedad y por qué es útil."
                    },
                    "summary_en": {
                        "type": "STRING", 
                        "description": "A concise 2 to 3 sentence technical summary in English."
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
                        "description": "Lista de hasta 6 etiquetas relevantes de palabras clave (ej. CUDA, NVIDIA, Update, SPCC, BlurXTerminator, StarNet)."
                    }
                },
                "required": ["title_es", "title_en", "summary_es", "summary_en", "category_es", "category_en", "tags"]
            }
        }
    }
    
    headers = {'Content-Type': 'application/json'}
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            
        # Parse output from response format
        text_response = res_data['candidates'][0]['content']['parts'][0]['text']
        gemini_result = json.loads(text_response)
        
        # Merge with item details
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

def process_fallback(item):
    """Fallback processor if API Key is missing or request fails."""
    print(f"Fallback processing for item: {item['title']}")
    
    # Simple rule-based tagging
    tags = ["PixInsight", "Update"]
    title_lower = item['title'].lower()
    if "cuda" in title_lower or "nvidia" in title_lower or "gpu" in title_lower:
        tags.extend(["GPU", "CUDA", "NVIDIA"])
    if "workshop" in title_lower or "dec" in title_lower or "jan" in title_lower:
        category_es = "TALLERES"
        category_en = "WORKSHOPS"
        tags.append("Taller")
    elif "script" in title_lower or "javascript" in title_lower:
        category_es = "SCRIPTS"
        category_en = "SCRIPTS"
    else:
        category_es = "SOFTWARE"
        category_en = "SOFTWARE"
        
    return {
        "id": item['url'],
        "title_es": f"[Auto] {item['title']}",
        "title_en": item['title'],
        "summary_es": f"Nueva actualización oficial publicada en el foro de PixInsight: {item['title']}. Por favor, configure GEMINI_API_KEY para habilitar traducciones automáticas avanzadas.",
        "summary_en": f"New official update published on the PixInsight forum: {item['title']}. Configure GEMINI_API_KEY to enable AI-powered translations and summarizations.",
        "category_es": category_es,
        "category_en": category_en,
        "date": item['date'],
        "url": item['url'],
        "tags": tags[:6]
    }

def main():
    print("Starting PixInsight News Scraper...")
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Warning: GEMINI_API_KEY environment variable not found. Running in fallback dry-run mode.")
        
    rss_items = fetch_rss_items()
    if not rss_items:
        print("No items fetched from RSS. Exiting.")
        return
        
    db = load_database()
    existing_ids = {entry['id'] for entry in db}
    
    new_items = [item for item in rss_items if item['url'] not in existing_ids]
    print(f"Found {len(rss_items)} RSS items, {len(new_items)} are new.")
    
    if not new_items:
        print("No new updates. Database is up to date.")
        return
        
    # Process only a few items to avoid API limits
    processed_count = 0
    updates_to_add = []
    
    for item in new_items[:MAX_ITEMS_TO_PROCESS]:
        print(f"Processing new item: {item['title']} ({item['date']})")
        processed_item = None
        
        if api_key:
            processed_item = process_with_gemini(item, api_key)
            
        if not processed_item:
            processed_item = process_fallback(item)
            
        if processed_item:
            updates_to_add.append(processed_item)
            processed_count += 1
            
    if updates_to_add:
        # Prepend new updates (so they show first)
        db = updates_to_add + db
        # Trim database if it exceeds max size
        if len(db) > MAX_DB_SIZE:
            db = db[:MAX_DB_SIZE]
        save_database(db)
        print(f"Successfully added {processed_count} new entries to novedades.json")
    else:
        print("No items processed successfully.")

if __name__ == "__main__":
    main()
