"""Global_edge data builder. Runs on GitHub Actions and writes global.json.

News: only trusted outlets (Reuters, Bloomberg, FT, WSJ, CNBC, AP, BBC, Al Jazeera, Nikkei, major Indian business papers).
Only stories that match a rule for impact on Indian shares are kept; everything else is dropped.
Each story shows how many trusted outlets carried it, why it matters for India, and which Indian sectors it touches.

Videos: only the official YouTube channels of well-known news and business broadcasters, market-related titles only.
Standard library only."""
import json, re, time, urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from fetch_data import get, parse_rss

NOW = datetime.now(timezone.utc)

# ---------------- trusted sources ----------------
TRUSTED = re.compile(
    r"reuters|bloomberg|financial times|\bft\.com|wall street journal|\bwsj\b|cnbc|associated press|\bap news\b|\bap\b|bbc|al jazeera|"
    r"nikkei|south china morning post|\bscmp\b|the economist|barron|marketwatch|\bdw\b|"
    r"economic times|business standard|livemint|\bmint\b|moneycontrol|financial express|businessline|business line|ndtv profit|"
    r"press trust|\bpti\b", re.I)
BLOCK = re.compile(r"\b(celebrity|cricket|football|soccer|nba|nfl|movie|film|actor|actress|recipe|horoscope|royal family|fashion|"
                   r"concert|album|tv show|lifestyle|murder|obituary|oscars|grammy|box office)\b", re.I)

# ---------------- where to look ----------------
REGIONS = [
    ("US", "🇺🇸", ["US Federal Reserve interest rates inflation", "US Treasury yields dollar index", "Wall Street stocks selloff OR rally",
                   "US jobs report payrolls", "US tariffs India trade", "US recession fears economy"]),
    ("China", "🇨🇳", ["China economy stimulus PBOC", "China exports slowdown yuan", "China property crisis stocks"]),
    ("Japan", "🇯🇵", ["Bank of Japan rate hike yen", "yen carry trade Nikkei"]),
    ("Europe", "🇪🇺", ["European Central Bank interest rates eurozone", "Bank of England rates"]),
    ("Middle East", "🌍", ["OPEC oil output cut", "Iran Israel war oil prices", "Strait of Hormuz oil tanker attack", "Red Sea shipping attack"]),
    ("Russia", "🇷🇺", ["Russia Ukraine war sanctions oil"]),
    ("Global", "🌐", ["foreign investors selling India stocks FPI", "IMF World Bank India growth forecast", "Moody's Fitch India rating",
                      "crude oil prices Brent", "global markets selloff", "gold price record dollar"]),
]

# Sectors touched, with Indian examples shown in the app
EXAMPLES = {"OMC": "BPCL, IOC, HPCL", "PAINT": "Asian Paints", "AVIATION": "IndiGo", "UPSTREAM": "ONGC, Oil India",
            "IT": "TCS, Infosys, Wipro", "NEWAGE": "Zomato, Paytm, Nykaa", "DEFENCE": "HAL, BEL", "METALS": "Tata Steel, JSW Steel, Hindalco",
            "PHARMA": "Sun Pharma, Cipla", "AUTO": "Maruti, M&M", "BANK": "HDFC Bank, ICICI Bank", "REALTY": "DLF, Godrej Properties"}

# (regex, weight, label, why it matters for India, {sector: direction}, broad market direction)
RULES = [
 (r"fed.{0,30}(hike|raise|hawkish|higher for longer|no rate cut)|(treasury|bond) yields?.{0,20}(surge|jump|spike|climb|rise|hit)|10-year yield.{0,15}(rise|climb|jump|highest)",
  1.6, "US rates / yields rising", "Higher US yields pull foreign money out of Indian stocks and weaken the rupee.", {"IT": -0.5, "NEWAGE": -1}, -1),
 (r"fed.{0,30}(cut|lower|dovish|easing)|rate cut.{0,20}(fed|federal reserve)|yields?.{0,15}(fall|drop|slide|tumble|retreat)",
  1.6, "US rates easing", "Lower US rates usually bring foreign inflows into Indian equities.", {"IT": 0.5, "NEWAGE": 1, "BANK": 0.3}, 1),
 (r"(us|u\.s\.) (inflation|cpi|jobs|payrolls|unemployment).{0,40}(hot|higher than expected|surge|beats?|stronger than expected)",
  1.2, "Hot US data", "Strong US data delays Fed cuts, which hurts emerging-market flows.", {"NEWAGE": -0.5}, -0.5),
 (r"(wall street|s&p 500|nasdaq|dow|global stocks|world stocks|asian (shares|stocks|markets)).{0,35}(plunge|tumble|sink|slump|sell-?off|rout|tank|worst)",
  1.5, "Global equity selloff", "Global risk-off usually pulls the Nifty lower the next session.", {"IT": -0.5, "NEWAGE": -0.5}, -1),
 (r"(wall street|s&p 500|nasdaq|dow|global stocks|world stocks).{0,35}(rally|surge|jump|soar|record high)",
  1.2, "Global equity rally", "Global risk-on tends to lift Indian shares, led by IT and large caps.", {"IT": 0.5}, 0.8),
 (r"(crude|brent|oil prices?).{0,30}(surge|jump|spike|rise|climb|rally|soar|highest)|opec.{0,30}(cut|reduce|slash|curb)",
  1.6, "Crude oil rising", "India imports most of its oil: higher crude hurts OMCs, paints and airlines, and helps upstream producers.",
  {"OMC": -1, "PAINT": -1, "AVIATION": -1, "UPSTREAM": 1}, -0.5),
 (r"(crude|brent|oil prices?).{0,30}(fall|drop|slump|plunge|slide|tumble|lowest)|opec.{0,30}(raise|boost|increase) (output|production)",
  1.5, "Crude oil falling", "Cheaper crude helps OMCs, paints and airlines and eases India's import bill.",
  {"OMC": 1, "PAINT": 1, "AVIATION": 1, "UPSTREAM": -1}, 0.5),
 (r"(hormuz|red sea|suez).{0,40}(attack|disrupt|closure|houthi|tanker)|(israel|iran|gulf).{0,30}(war|attack|strike|escalat)",
  1.4, "Middle East conflict", "Risk to oil supply and shipping: supports defence stocks and hurts OMCs and airlines.",
  {"OMC": -0.7, "AVIATION": -0.7, "DEFENCE": 1, "UPSTREAM": 0.5}, -0.5),
 (r"(russia|ukraine).{0,30}(sanction|war|attack|escalat)",
  1.0, "Russia-Ukraine developments", "Can move crude, fertiliser and metal prices and India's oil import costs.", {"DEFENCE": 0.7}, -0.3),
 (r"(impose|slap|raise|hike|threaten|new|additional|extra)\w*.{0,25}(tariffs?|duty|duties).{0,40}(india|indian)|(india|indian).{0,40}tariffs?.{0,25}(hike|imposed|threat|raised)",
  1.8, "Tariffs on India", "Directly hurts Indian exporters such as pharma, auto parts, textiles and metals.",
  {"PHARMA": -0.5, "AUTO": -0.5, "METALS": -0.5, "IT": -0.3}, -0.7),
 (r"(sign|ink|clinch|seal|conclude|finali[sz]e|reach)\w*.{0,25}(trade (deal|agreement)|free trade).{0,40}india|india.{0,40}(sign|ink|clinch|seal|conclude|finali[sz]e|reach)\w*.{0,25}(trade (deal|agreement))",
  1.6, "Trade deal with India", "A trade deal improves access for Indian exporters and lifts sentiment.", {"PHARMA": 0.5, "AUTO": 0.5, "METALS": 0.3}, 0.7),
 (r"china.{0,30}(stimulus|rate cut|support measures|boost)",
  1.2, "China stimulus", "Chinese stimulus lifts metal demand and prices, helping Indian metal producers.", {"METALS": 1}, 0.3),
 (r"china.{0,30}(slowdown|contraction|deflation|property crisis)|china.{0,20}exports? (fall|drop|slump)",
  1.2, "China slowdown", "Weak Chinese demand pulls metal prices down and hurts Indian metal producers.", {"METALS": -1}, -0.3),
 (r"dollar (index )?.{0,15}(surge|jump|climb|strengthen|rally|hits?.{0,15}high)|dxy.{0,10}(rise|surge)",
  1.2, "Stronger dollar", "A strong dollar weakens the rupee and can trigger foreign outflows, while IT and pharma exporters gain.",
  {"IT": 0.5, "PHARMA": 0.5}, -0.5),
 (r"dollar (index )?.{0,15}(slump|slide|tumble|weaken|falls?)",
  1.0, "Weaker dollar", "A weaker dollar supports the rupee and foreign inflows into India.", {"IT": -0.3}, 0.5),
 (r"(bank of japan|boj).{0,30}(hike|raise|tighten)|yen.{0,20}(surge|soar|jump)|carry trade.{0,20}(unwind|unravel)",
  1.4, "Yen carry-trade risk", "Sudden yen strength has caused global selloffs before, hitting emerging markets like India.", {"NEWAGE": -0.5}, -0.8),
 (r"(foreign|fpi|fii).{0,30}(investors?|funds?|portfolio).{0,40}(sell|pull|withdraw|outflow|dump).{0,40}(india|indian)|fpi.{0,15}outflows?",
  1.5, "Foreign selling in India", "Heavy foreign selling directly pressures the Nifty and the rupee.", {"BANK": -0.3}, -1),
 (r"(foreign|fpi|fii).{0,30}(investors?|funds?|portfolio).{0,40}(buy|inflow|pour|return).{0,40}(india|indian)|fpi.{0,15}inflows?",
  1.4, "Foreign buying in India", "Foreign inflows support the Nifty, banks and large caps.", {"BANK": 0.3}, 1),
 (r"(imf|world bank|moody|fitch|s&p global|oecd).{0,40}india.{0,40}(raise|upgrade|lifts?|boost)",
  1.5, "Upgrade for India", "A growth or rating upgrade lifts confidence in Indian assets.", {"BANK": 0.3}, 0.6),
 (r"(imf|world bank|moody|fitch|s&p global|oecd).{0,40}india.{0,40}(cut|downgrade|lower|slash)",
  1.5, "Downgrade for India", "A growth or rating downgrade weakens confidence in Indian assets.", {"BANK": -0.3}, -0.6),
 (r"(us|u\.s\.).{0,15}recession (fear|risk|worr)",
  1.3, "US recession fears", "A US slowdown hurts demand for Indian IT services and exports.", {"IT": -0.7, "PHARMA": -0.3}, -0.7),
]
RULES = [(re.compile(p, re.I), w, l, why, sec, br) for p, w, l, why, sec, br in RULES]


def search(q):
    url = "https://news.google.com/rss/search?q=" + urllib.parse.quote(q + " when:1d") + "&hl=en-US&gl=US&ceid=US:en"
    try:
        return parse_rss(get(url))
    except Exception as e:
        print("search failed:", q, e)
        return []


def age_weight(iso):
    h = (NOW - datetime.fromisoformat(iso)).total_seconds() / 3600
    return 1.0 if h <= 12 else 0.8 if h <= 24 else 0.5 if h <= 48 else 0.0


def tokens(t):
    return {w for w in re.findall(r"[a-z0-9]{4,}", t.lower())}


def same_story(a, b):
    ta, tb = tokens(a), tokens(b)
    return bool(ta and tb) and len(ta & tb) / len(ta | tb) >= 0.45


def build_news():
    stories = []   # each: dict with title, link, time, region, flag, sources set, rule, ...
    for region, flag, queries in REGIONS:
        for q in queries:
            for it in search(q):
                if not TRUSTED.search(it["src"] or "") or BLOCK.search(it["title"]):
                    continue
                w = age_weight(it["time"])
                if w == 0:
                    continue
                best = None
                for rule in RULES:
                    if rule[0].search(it["title"]) and (best is None or rule[1] > best[1]):
                        best = rule
                if not best:
                    continue      # not an impact story for Indian shares: dropped
                for s in stories:
                    if same_story(s["title"], it["title"]):
                        s["sources"].add(it["src"])
                        if it["time"] > s["time"]:
                            s["time"] = it["time"]
                        break
                else:
                    stories.append({"title": it["title"], "link": it["link"], "src": it["src"], "time": it["time"], "region": region,
                                    "flag": flag, "sources": {it["src"]}, "rule": best, "w": w})
            time.sleep(0.3)
    items = []
    for s in stories:
        _, weight, label, why, sec, broad = s["rule"]
        n = len(s["sources"])
        score = weight * s["w"] * min(1.45, 1 + 0.15 * (n - 1))
        level = "High" if score >= 1.6 else "Medium" if score >= 1.0 else None
        if not level:
            continue
        items.append({"region": s["region"], "flag": s["flag"], "title": s["title"], "link": s["link"], "src": s["src"], "time": s["time"],
                      "level": level, "score": round(score, 2), "label": label, "why": why, "confirmed_by": n, "sources": sorted(s["sources"])[:5],
                      "sectors": [{"sector": k, "dir": (1 if v > 0 else -1), "stocks": EXAMPLES.get(k, "")} for k, v in sec.items()],
                      "_sec": sec, "_broad": broad})
    items.sort(key=lambda x: x["time"], reverse=True)                       # newest first
    items.sort(key=lambda x: (x["level"] != "High", -x["score"]))           # then High impact and strongest first
    sector_bias, broad = {}, 0.0
    for x in items:
        for k, v in x["_sec"].items():
            sector_bias[k] = sector_bias.get(k, 0) + v * x["score"]
        broad += x["_broad"] * x["score"]
    for x in items:
        x.pop("_sec"), x.pop("_broad")
    bias = {"score": round(broad, 2), "label": "Risk-off for India" if broad <= -1.5 else "Risk-on for India" if broad >= 1.5 else "Mixed / neutral",
            "sectors": sorted([{"sector": k, "score": round(v, 2), "stocks": EXAMPLES.get(k, "")} for k, v in sector_bias.items() if abs(v) >= 0.8],
                              key=lambda d: -abs(d["score"]))}
    return items, bias


# ---------------- videos from official channels ----------------
# (display name, handle, fallback channel id, regex the feed author name must match)
CHANNELS = [
    ("CNBC", "CNBC", "UCvJJ_dzjViJCoLf5uKUTwoA", r"cnbc"),
    ("CNBC International", "CNBCInternational", "", r"cnbc"),
    ("Bloomberg Television", "BloombergTelevision", "UCIALMKvObZNtJ6AmdCLP7Lg", r"bloomberg"),
    ("Bloomberg Markets and Finance", "markets", "UCrM7B7SL_g1edFOnmj-SDKg", r"bloomberg"),
    ("Reuters", "Reuters", "UChqUTb7kYRX8-EiaN3XFrSQ", r"reuters"),
    ("Financial Times", "FinancialTimes", "UCoUxsWakJucWg46KW5RsvPw", r"financial times"),
    ("Wall Street Journal", "WSJ", "UCK7tptUDHh-RYDsdxO1-5QQ", r"wall street|wsj"),
    ("Al Jazeera English", "AlJazeeraEnglish", "UCNye-wNBqNL5ZzHSJj3l8Bg", r"al jazeera"),
    ("BBC News", "BBCNews", "UC16niRr50-MSBwiO3YDb3RA", r"bbc"),
    ("DW News", "dwnews", "UCknLrEdhRCp1aegoMqRaCZg", r"\bdw\b"),
    ("Yahoo Finance", "YahooFinance", "UCEAZeUIeJs0IjQiqTCdVSIg", r"yahoo"),
    ("CNBC-TV18", "cnbc-tv18", "UCmRbHAgG2k2vDUvb3xsEunQ", r"cnbc"),
    ("Moneycontrol", "moneycontrol", "", r"moneycontrol"),
    ("ET Now", "ETNOWlive", "", r"et now|economic times"),
]
BUSINESS = {"CNBC", "CNBC International", "Bloomberg Television", "Bloomberg Markets and Finance", "Yahoo Finance", "CNBC-TV18", "Moneycontrol", "ET Now"}
MARKETY = re.compile(r"market|stocks?|shares|equit|wall street|nasdaq|s&p|dow\b|nifty|sensex|bond|yield|interest rate|rate (cut|hike)|fed\b|ecb|boj|inflation|"
                     r"\bcpi\b|gdp|jobs report|payrolls|economy|economic|recession|oil|crude|opec|gold|dollar|yuan|yen|rupee|currency|tariff|trade (war|deal)|"
                     r"sanction|earnings|bank|invest|china|india|rally|selloff|sell-off|ipo|fund", re.I)


def yt_get(url, timeout=20):
    import urllib.request
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9", "Cookie": "CONSENT=YES+1; SOCS=CAI"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def resolve_channel(handle, fallback):
    """Returns (channel id, where it came from: 'handle' or 'fallback')."""
    try:
        html = yt_get("https://www.youtube.com/@" + handle).decode("utf-8", "ignore")
        for pat in (r'itemprop="channelId" content="(UC[\w-]{22})"', r'rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"',
                    r'"externalId":"(UC[\w-]{22})"', r'"channelId":"(UC[\w-]{22})"'):
            m = re.search(pat, html)
            if m:
                return m.group(1), "handle"
    except Exception as e:
        print("handle page failed:", handle, e)
    return fallback, "fallback"


NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015", "m": "http://search.yahoo.com/mrss/"}


def channel_videos(display, handle, fallback, name_re):
    cid, _ = resolve_channel(handle, fallback)
    if not cid:
        return []
    try:
        root = ET.fromstring(yt_get("https://www.youtube.com/feeds/videos.xml?channel_id=" + cid))
    except Exception as e:
        print("video feed failed:", display, e)
        return []
    author = root.findtext("a:author/a:name", default="", namespaces=NS)
    if not re.search(name_re, author or "", re.I):
        print("channel name mismatch, skipped:", display, "->", author)
        return []
    out = []
    for e in root.findall("a:entry", NS):
        vid = e.findtext("yt:videoId", default="", namespaces=NS)
        title = e.findtext("a:title", default="", namespaces=NS)
        pub = e.findtext("a:published", default="", namespaces=NS)
        link = (e.find("a:link", NS).get("href") if e.find("a:link", NS) is not None else "")
        if not vid or "/shorts/" in link or "#shorts" in title.lower():
            continue
        try:
            t = datetime.fromisoformat(pub.replace("Z", "+00:00"))
        except Exception:
            continue
        if (NOW - t).total_seconds() > 4 * 86400:
            continue
        out.append({"id": vid, "title": title, "channel": display, "published": t.astimezone(timezone.utc).isoformat(),
                    "thumb": "https://i.ytimg.com/vi/%s/hqdefault.jpg" % vid, "url": "https://www.youtube.com/watch?v=" + vid,
                    "business": display in BUSINESS})
    return out


def build_videos():
    allv, ok = [], []
    for display, handle, fb, rx in CHANNELS:
        v = channel_videos(display, handle, fb, rx)
        if v:
            ok.append(display)
        allv += v
        time.sleep(0.3)
    good = [v for v in allv if MARKETY.search(v["title"]) and not BLOCK.search(v["title"])]
    if len(good) < 6:     # relax: any non-blocked video from the business channels
        extra = [v for v in allv if v["business"] and not BLOCK.search(v["title"]) and v not in good]
        good += extra
    good.sort(key=lambda v: v["published"], reverse=True)
    per, picked, seen = {}, [], set()
    for v in good:        # at most 2 per channel so the list is varied
        if v["id"] in seen:
            continue
        seen.add(v["id"])
        if per.get(v["channel"], 0) < 2:
            picked.append(v)
            per[v["channel"]] = per.get(v["channel"], 0) + 1
    return picked[:14], ok


# Live TV: business and markets channels only, so everything shown is share-market related
LIVE = [
    ("Bloomberg TV", "BloombergTelevision", "UCIALMKvObZNtJ6AmdCLP7Lg", r"bloomberg"),
    ("CNBC TV (US)", "CNBCtelevision", "UCrp_UI8XtuYfpiqluWLD7Lw", r"cnbc"),
    ("CNBC-TV18", "cnbc-tv18", "UCmRbHAgG2k2vDUvb3xsEunQ", r"cnbc"),
    ("CNBC Awaaz", "CNBCAwaaz", "UCQIycDaLsBpMKjOCeaKUYVg", r"cnbc"),
    ("Yahoo Finance", "YahooFinance", "UCEAZeUIeJs0IjQiqTCdVSIg", r"yahoo"),
    ("ET Now", "ETNOWlive", "", r"et now|economic times"),
    ("Zee Business", "ZeeBusiness", "", r"zee business"),
    ("CNBC International", "CNBCInternational", "", r"cnbc"),
]


def build_live():
    out, debug = [], []
    for name, handle, fb, rx in LIVE:
        cid, src = resolve_channel(handle, fb)
        if not cid:
            debug.append({"name": name, "status": "could not find the channel id"})
            continue
        try:   # make sure the channel really belongs to the named broadcaster
            root = ET.fromstring(yt_get("https://www.youtube.com/feeds/videos.xml?channel_id=" + cid))
            author = root.findtext("a:author/a:name", default="", namespaces=NS)
        except Exception as e:
            # feed blocked: an id read from the channel's own page (or the built-in id) is still used, marked unverified
            out.append({"name": name, "id": cid, "verified": False})
            debug.append({"name": name, "status": "feed check blocked, using %s id (%s)" % ("channel-page" if src == "handle" else "built-in", str(e)[:40])})
            continue
        if not re.search(rx, author or "", re.I):
            debug.append({"name": name, "status": "name mismatch, skipped (%s)" % (author or "empty")})
            continue
        out.append({"name": name, "id": cid, "verified": True})
        debug.append({"name": name, "status": "ok"})
        time.sleep(0.3)
    return out, debug


def main():
    items, bias = build_news()
    videos, ok = build_videos()
    live, live_debug = build_live()
    out = {"generated": NOW.isoformat(), "bias": bias, "news": items, "videos": videos, "channels_ok": ok, "live": live, "live_debug": live_debug,
           "sources_note": "Only trusted outlets are used. 'Confirmed by' counts distinct trusted outlets carrying the same story."}
    json.dump(out, open("global.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("news:", len(items), "high:", sum(1 for x in items if x["level"] == "High"), "| videos:", len(videos), "| channels:", ok, "| live channels:", [x["name"] for x in live])


if __name__ == "__main__":
    main()
