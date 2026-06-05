import urllib.request
import urllib.parse
import re
import json
import os
import sys
import time

# Ensure safe console printing
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Load Centralized YouTubers/Creators
TOOLS_DIR = os.path.dirname(__file__)
CREATORES_FILE = os.path.join(TOOLS_DIR, "creadores.json")
CREATORS = []

if os.path.exists(CREATORES_FILE):
    try:
        with open(CREATORES_FILE, "r", encoding="utf-8") as f:
            creators_data = json.load(f)
            for c in creators_data:
                CREATORS.append({
                    "name": c["name"],
                    "search": f"{c['name']} PixInsight",
                    "owners": c["owners"]
                })
    except Exception as e:
        print(f"Error loading creadores.json: {e}")

# Fallback default list if json file is missing or empty
if not CREATORS:
    CREATORS = [
        {"name": "Adam Block", "search": "Adam Block PixInsight", "owners": ["Adam Block"]},
        {"name": "Cuiv, The Lazy Geek", "search": "Cuiv PixInsight", "owners": ["Cuiv, The Lazy Geek", "Cuiv"]},
        {"name": "The Space Koala", "search": "The Space Koala PixInsight", "owners": ["The Space Koala"]},
        {"name": "SetiAstro", "search": "SetiAstro PixInsight", "owners": ["SetiAstro"]},
        {"name": "Patriot Astro", "search": "Patriot Astro PixInsight", "owners": ["Patriot Astro"]},
        {"name": "Utah Desert Remote Observatories", "search": "Utah Desert Remote Observatories PixInsight", "owners": ["Utah Desert Remote Observatories", "Utah Desert Remote"]},
        {"name": "Lukomatico", "search": "Lukomatico PixInsight", "owners": ["Lukomatico"]},
        {"name": "TAIC", "search": "The Astro Imaging Channel PixInsight", "owners": ["The Astro Imaging Channel", "TAIC"]},
        {"name": "View into Space", "search": "View into Space PixInsight", "owners": ["View into Space"]},
        {"name": "Nebula Photos", "search": "Nebula Photos PixInsight", "owners": ["Nebula Photos"]},
        {"name": "Astro Academy", "search": "Astro Academy PixInsight", "owners": ["Astro Academy", "AstroAcademy"]},
        {"name": "Natural Portraits", "search": "Natural Portraits PixInsight", "owners": ["Natural Portraits"]},
        {"name": "Astrocitas", "search": "Astrocitas PixInsight", "owners": ["Astrocitas"]},
        {"name": "Astrotivissa", "search": "Astrotivissa PixInsight", "owners": ["Astrotivissa"]},
        {"name": "Naztronomy", "search": "Naztronomy PixInsight", "owners": ["Naztronomy"]},
        {"name": "Astrocity", "search": "Astrocity PixInsight", "owners": ["Astrocity", "Astrocity - Astrofotografía"]},
        {"name": "Ed Ting", "search": "Ed Ting PixInsight", "owners": ["Ed Ting"]},
        {"name": "Dylan O'Donnell", "search": "Dylan O'Donnell PixInsight", "owners": ["Dylan O'Donnell", "Dylan O’Donnell", "Dylan ODonnell"]},
        {"name": "Astrobackyard", "search": "Astrobackyard PixInsight", "owners": ["Astrobackyard", "Astro Backyard"]}
    ]


def get_years_ago(text):
    text = text.lower()
    m = re.search(r'(\d+)\s*(year|año)', text)
    if m:
        return int(m.group(1))
    return 0

def get_view_count(text):
    if not text:
        return 0
    text_raw = text.lower().replace('\xa0', ' ').strip()
    if ',' in text_raw and any(x in text_raw for x in ['m', 'k', 'de', 'mil', ' ']):
        text_raw = text_raw.replace(',', '.')
    
    m = re.search(r'([\d\.]+)\s*(m|million|mill|millones)', text_raw)
    if m:
        try:
            return int(float(m.group(1)) * 1000000)
        except ValueError:
            pass
            
    m = re.search(r'([\d\.]+)\s*(k|mil|thousand)', text_raw)
    if m:
        try:
            return int(float(m.group(1)) * 1000)
        except ValueError:
            pass
            
    cleaned = text_raw.replace('.', '').replace(',', '')
    digits = re.sub(r'[^\d]', '', cleaned)
    if digits:
        return int(digits)
    return 0

def parse_duration_seconds(duration_str):
    # e.g., "14:20", "1:05:30"
    if not duration_str or duration_str == 'N/A':
        return 0
    parts = duration_str.split(':')
    try:
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        elif len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except ValueError:
        pass
    return 0

def local_fallback_classify(title, creator_name):
    title_lower = title.lower()
    
    # Check relevance first (if not relevant, return None)
    relevance_keywords = ['pixinsight', 'pix', 'pi ', 'blurx', 'noisex', 'starx', 'spcc', 'ghs', 'weightedbatch', 'wbpp', 'pixelmath']
    is_relevant = any(k in title_lower for k in relevance_keywords) or 'pixinsight' in creator_name.lower()
    
    if not is_relevant:
        return None
        
    # Classify level
    beginner_kws = ['basic', 'beginner', 'principiante', 'introduccion', 'introduction', 'wbpp', 'quick', 'inicio', 'desde cero', 'first look', 'calibracion', 'calibración', 'stacking', 'apilado', 'guía', 'guide']
    advanced_kws = ['advanced', 'avanzado', 'pixelmath', 'narrowband', 'math', 'formulas', 'fórmula', 'complex', 'mosaico', 'mosaic', 'deconvolution', 'deconvolución', 'scripting', 'foraxx', 'sho', 'hoo', 'bicolor', 'hubble']
    
    is_beginner = any(k in title_lower for k in beginner_kws)
    is_advanced = any(k in title_lower for k in advanced_kws)
    
    if is_beginner:
        level = "PRINCIPIANTE"
    elif is_advanced:
        level = "AVANZADO"
    else:
        level = "MEDIO"
        
    return {
        "relevant": True,
        "title_es": title,
        "title_en": title,
        "summary_es": f"Vídeo tutorial sobre PixInsight de {creator_name} explicando técnicas de procesamiento.",
        "summary_en": f"PixInsight tutorial video by {creator_name} explaining processing techniques.",
        "level": level
    }

def process_with_gemini(video, api_key):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    
    prompt = f"""
    You are an expert astrophotographer and PixInsight specialist.
    Analyze the following YouTube video about PixInsight:
    
    Title: "{video['raw_title']}"
    Author/Channel: "{video['author']}"
    
    Verify if it is directly relevant to PixInsight processing, workflows, tools, scripts, or tutorials.
    If it is NOT relevant to PixInsight (e.g., camera reviews, general telescope setups, Photoshop, Siril, or NINA tutorials WITHOUT PixInsight context), mark relevant = false.
    If it is relevant, translate and clean the title to Spanish and English, translate/create a 2-3 sentence technical summary in both languages, and classify the difficulty level into one of: "PRINCIPIANTE", "MEDIO", or "AVANZADO".
    
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
                        "description": "True if directly relevant to PixInsight tutorials, workflows, tools, or scripts. False otherwise."
                    },
                    "title_es": {
                        "type": "STRING", 
                        "description": "Clean and natural Spanish title, free from YouTube clickbait and excessive emojis."
                    },
                    "title_en": {
                        "type": "STRING", 
                        "description": "Clean and natural English title."
                    },
                    "summary_es": {
                        "type": "STRING", 
                        "description": "Concise technical summary in Spanish of 2 to 3 sentences explaining what this video teaches."
                    },
                    "summary_en": {
                        "type": "STRING", 
                        "description": "Concise technical summary in English of 2 to 3 sentences."
                    },
                    "level": {
                        "type": "STRING", 
                        "enum": ["PRINCIPIANTE", "MEDIO", "AVANZADO"],
                        "description": "Difficulty level for learning: PRINCIPIANTE (Beginner), MEDIO (Intermediate), AVANZADO (Advanced)."
                    }
                },
                "required": ["relevant", "title_es", "title_en", "summary_es", "summary_en", "level"]
            }
        }
    }
    
    headers = {'Content-Type': 'application/json'}
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    
    max_retries = 3
    retry_delay = 6.0
    
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                res_data = json.loads(response.read().decode('utf-8'))
            text_response = res_data['candidates'][0]['content']['parts'][0]['text']
            return json.loads(text_response)
        except urllib.error.HTTPError as he:
            if he.code in [429, 503, 504] and attempt < max_retries - 1:
                print(f"Gemini API returned HTTP {he.code}. Retrying in {retry_delay}s (Attempt {attempt+1}/{max_retries})...")
                time.sleep(retry_delay)
                retry_delay *= 2  # Exponential backoff
            else:
                print(f"Error calling Gemini API for '{video['raw_title']}': {he}")
                return None
        except Exception as e:
            print(f"Error calling Gemini API for '{video['raw_title']}': {e}")
            return None

def process_with_deepseek(video, api_key):
    """Uses the DeepSeek API to translate, summarize, and classify difficulty level for a video."""
    url = "https://api.deepseek.com/chat/completions"
    
    system_prompt = """You are an expert astrophotographer and PixInsight specialist.
Analyze the following YouTube video about PixInsight:
Verify if it is directly relevant to PixInsight processing, workflows, tools, scripts, or tutorials.
If it is NOT relevant to PixInsight (e.g., camera reviews, general telescope setups, Photoshop, Siril, or NINA tutorials WITHOUT PixInsight context), mark relevant = false.
If it is relevant, translate and clean the title to Spanish and English, translate/create a 2-3 sentence technical summary in both languages, and classify the difficulty level into one of: "PRINCIPIANTE", "MEDIO", or "AVANZADO".

You MUST respond ONLY with a JSON object matching this schema:
{
  "relevant": boolean,
  "title_es": "A clean, natural Spanish title (translated and adapted, no excessive emojis or YouTube clickbait)",
  "title_en": "A refined, clean title in English",
  "summary_es": "A technical summary in Spanish of 2-3 sentences explaining what this video teaches",
  "summary_en": "A concise technical summary in English of 2-3 sentences",
  "level": "PRINCIPIANTE" | "MEDIO" | "AVANZADO"
}
Do not include any explanation or markdown formatting (like ```json). Respond with the raw JSON object."""

    user_prompt = f"""Title: "{video['raw_title']}"
Author/Channel: "{video['author']}" """

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
            with urllib.request.urlopen(req, timeout=15) as response:
                res_data = json.loads(response.read().decode('utf-8'))
            text_response = res_data['choices'][0]['message']['content'].strip()
            return json.loads(text_response)
        except urllib.error.HTTPError as he:
            if he.code in [429, 503, 504] and attempt < max_retries - 1:
                print(f"DeepSeek API returned HTTP {he.code}. Retrying in {retry_delay}s (Attempt {attempt+1}/{max_retries})...")
                time.sleep(retry_delay)
                retry_delay *= 2
            else:
                print(f"Error calling DeepSeek API for '{video['raw_title']}': {he}")
                return None
        except Exception as e:
            print(f"Error calling DeepSeek API for '{video['raw_title']}': {e}")
            return None

def scrape_youtube_videos(query):
    encoded_query = urllib.parse.quote(query)
    url = f"https://www.youtube.com/results?search_query={encoded_query}"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
    }
    
    req = urllib.request.Request(url, headers=headers)
    videos = []
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            html_content = response.read().decode('utf-8', errors='ignore')
            
            m = re.search(r'ytInitialData\s*=\s*(\{.*?\});', html_content)
            if not m:
                return []
                
            data = json.loads(m.group(1))
            contents = data['contents']['twoColumnSearchResultsRenderer']['primaryContents']['sectionListRenderer']['contents']
            
            for item in contents:
                if 'itemSectionRenderer' in item:
                    section_contents = item['itemSectionRenderer']['contents']
                    for subitem in section_contents:
                        if 'videoRenderer' in subitem:
                            video = subitem['videoRenderer']
                            video_id = video.get('videoId')
                            raw_title = video.get('title', {}).get('runs', [{}])[0].get('text', 'No Title')
                            published = video.get('publishedTimeText', {}).get('simpleText', 'Unknown Date')
                            views_str = video.get('viewCountText', {}).get('simpleText', '0 views')
                            length = video.get('lengthText', {}).get('simpleText', 'N/A')
                            author = video.get('ownerText', {}).get('runs', [{}])[0].get('text', 'Unknown')
                            
                            videos.append({
                                "video_id": video_id,
                                "raw_title": raw_title,
                                "author": author,
                                "length": length,
                                "published_relative": published,
                                "views_str": views_str
                            })
    except Exception as e:
        print(f"Error scraping query '{query}': {e}")
    return videos

def main():
    db_path = "youtube_courses.json"
    cache = {}
    if os.path.exists(db_path):
        try:
            with open(db_path, "r", encoding="utf-8") as f:
                existing_data = json.load(f)
                for item in existing_data:
                    cache[item["youtube_id"]] = item
            print(f"Loaded {len(cache)} items from cache.")
        except Exception as e:
            print(f"Could not load cache: {e}")

    gemini_key = os.environ.get("GEMINI_API_KEY")
    deepseek_key = os.environ.get("DEEPSEEK_API_KEY")
    if not gemini_key and not deepseek_key:
        print("Warning: Neither GEMINI_API_KEY nor DEEPSEEK_API_KEY environment variables found. Running in fallback mode.")

    all_raw_videos = []
    
    # Scrape each creator
    for creator in CREATORS:
        print(f"Scraping YouTube for {creator['name']}...")
        # Query 1: Channel + PixInsight
        vids1 = scrape_youtube_videos(creator['search'])
        all_raw_videos.extend(vids1)
        time.sleep(2) # Sleep to avoid rate limits
        
    print(f"Total raw videos harvested: {len(all_raw_videos)}")
    
    # Deduplicate raw videos by video_id
    unique_videos = {}
    for v in all_raw_videos:
        if v["video_id"] not in unique_videos:
            unique_videos[v["video_id"]] = v
            
    print(f"Unique videos after de-duplication: {len(unique_videos)}")
    
    processed_items = []
    skipped_count = 0
    
    for video_id, video in unique_videos.items():
        # Apply filters
        # 1. Filter out videos that do not match any creator's owner names
        author_lower = video["author"].lower()
        matched_creator = None
        for creator in CREATORS:
            if any(owner.lower() in author_lower or author_lower in owner.lower() for owner in creator["owners"]):
                matched_creator = creator
                break
        
        if not matched_creator:
            # Skip video if author doesn't match our creator list
            continue
            
        # 2. Filter age and views: older than 7 years must have >= 10,000 views
        years_ago = get_years_ago(video["published_relative"])
        views = get_view_count(video["views_str"])
        
        if years_ago > 7 and views < 10000:
            # Skip old videos unless classic
            print(f"Skipping old video '{video['raw_title']}' ({years_ago} years old, {views} views)")
            skipped_count += 1
            continue
            
        # 3. Use cache if available
        if video_id in cache:
            # Keep existing entry, but update views and published text
            entry = cache[video_id].copy()
            entry["views"] = views
            entry["published_relative"] = video["published_relative"]
            entry["length"] = video["length"]
            processed_items.append(entry)
            continue
            
        # 4. Process new video
        result = None
        
        # 4a. Try Gemini first
        if gemini_key:
            print(f"Processing new video via Gemini: '{video['raw_title']}' by {video['author']}...")
            result = process_with_gemini(video, gemini_key)
            time.sleep(6.0) # Rate limit delay for Gemini Free Tier
            if result:
                if not result.get("relevant", False):
                    print(f"Gemini classified video as not relevant: '{video['raw_title']}'")
                    continue
            else:
                print("Gemini failed. Will attempt failover to DeepSeek if key is available...")
                
        # 4b. Try DeepSeek if Gemini failed or was not tried
        if result is None and deepseek_key:
            print(f"Processing new video via DeepSeek: '{video['raw_title']}' by {video['author']}...")
            result = process_with_deepseek(video, deepseek_key)
            time.sleep(2.0) # Rate limit delay for DeepSeek
            if result:
                if not result.get("relevant", False):
                    print(f"DeepSeek classified video as not relevant: '{video['raw_title']}'")
                    continue
            else:
                print("DeepSeek failed as well.")
                
        # 4c. Local fallback if both APIs failed
        if not result:
            print(f"Processing new video via Fallback: '{video['raw_title']}'...")
            result = local_fallback_classify(video['raw_title'], matched_creator['name'])
            if not result:
                continue
                
        # Create course item
        course_item = {
            "youtube_id": video_id,
            "title_es": result["title_es"],
            "title_en": result["title_en"],
            "summary_es": result["summary_es"],
            "summary_en": result["summary_en"],
            "level": result["level"],
            "author": matched_creator["name"],
            "length": video["length"],
            "published_relative": video["published_relative"],
            "views": views,
            "url": f"https://www.youtube.com/watch?v={video_id}"
        }
        processed_items.append(course_item)
        # Update cache dictionary in case of repeats
        cache[video_id] = course_item

    print(f"Total processed videos for database: {len(processed_items)}")
    print(f"Skipped {skipped_count} old/non-classic videos.")
    
    # Save database
    try:
        with open(db_path, "w", encoding="utf-8") as f:
            json.dump(processed_items, f, indent=2, ensure_ascii=False)
        print("Successfully saved youtube_courses.json")
    except Exception as e:
        print(f"Error saving youtube_courses.json: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
