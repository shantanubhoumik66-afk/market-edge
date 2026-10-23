"""India_edge data fetcher. Runs on GitHub Actions, writes data.json.
Uses only Python standard library, so nothing needs to be installed."""
import json, re, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}


def get(url, timeout=25):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def parse_rss(xml_bytes):
    out = []
    root = ET.fromstring(xml_bytes)
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        src = (it.findtext("source") or "").strip()
        m = re.match(r"^(.*) - ([^-]+)$", title)
        if m:
            title, src = m.group(1), m.group(2)
        try:
            t = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
        except Exception:
            t = datetime.now(timezone.utc)
        out.append({"title": title, "link": link, "src": src.strip(), "time": t.isoformat()})
    return out


def gnews(q):
    url = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(q + " when:3d")
           + "&hl=en-IN&gl=IN&ceid=IN:en")
    try:
        return parse_rss(get(url))
    except Exception as e:
        print("gnews failed:", q, e)
        return []


def rbi_official():
    try:
        items = parse_rss(get("https://www.rbi.org.in/pressreleases_rss.xml"))
        for i in items:
            i["src"] = "RBI"
        if items:
            return items
    except Exception as e:
        print("RBI feed failed:", e)
    return gnews("site:rbi.org.in press release")  # fallback


def uniq(items):
    seen, out = set(), []
    for i in sorted(items, key=lambda x: x["time"], reverse=True):
        if i["title"] not in seen:
            seen.add(i["title"])
            out.append(i)
    return out


def quote(sym):
    path = "/v8/finance/chart/" + urllib.parse.quote(sym) + "?interval=1d&range=1d"
    for host in ("query1", "query2"):
        try:
            j = json.loads(get("https://%s.finance.yahoo.com%s" % (host, path), 15))
            m = j["chart"]["result"][0]["meta"]
            p, prev = m["regularMarketPrice"], m["chartPreviousClose"]
            return {"price": round(p, 2), "chg": round((p / prev - 1) * 100, 2)}
        except Exception:
            continue
    return None


def world_bank(ind):
    try:
        j = json.loads(get("https://api.worldbank.org/v2/country/IN/indicator/%s?format=json&per_page=6" % ind))
        for x in j[1]:
            if x["value"] is not None:
                return {"date": x["date"], "value": round(x["value"], 2)}
    except Exception as e:
        print("worldbank failed:", ind, e)
    return None


# ---------- stock impact engine (edit freely) ----------
POS = re.compile(r"\b(rise|rises|rose|surge|jump|gain|beat|cut|cuts|eases|ease|approve|approves|approved|boost|record high|upgrade|growth|expands?|rally|soars?|incentive|relief)\b", re.I)
NEG = re.compile(r"\b(fall|falls|fell|drop|plunge|slump|miss|hike|hikes|raise|raises|ban|bans|curb|penalty|downgrade|slows?|contracts?|decline|declines|crash|probe|fine|tightens?)\b", re.I)
MAP = [
    (r"repo rate|rate cut|rate hike|mpc|crr|liquidity|npa", ["HDFCBANK", "ICICIBANK", "BAJFINANCE"], "Rates and liquidity"),
    (r"crude|brent|oil price|opec|fuel price", ["ONGC", "BPCL", "IOC"], "Crude oil"),
    (r"rupee|dollar|forex|it services|us recession|h-1b", ["TCS", "INFY", "HCLTECH"], "Rupee / IT exports"),
    (r"gst on|auto sales|ev subsid|vehicle|scrappage", ["MARUTI", "M&M", "TATAMOTORS"], "Auto policy / demand"),
    (r"defen[cs]e|missile|\bhal\b|\bbel\b|navy|air force", ["HAL", "BEL", "BDL"], "Defence orders"),
    (r"solar|renewable|power tariff|green hydrogen|discom|coal", ["NTPC", "ADANIGREEN", "TATAPOWER"], "Power / renewables"),
    (r"steel|safeguard duty|iron ore|anti-dumping", ["TATASTEEL", "JSWSTEEL", "SAIL"], "Steel duties / demand"),
    (r"telecom|spectrum|tariff hike|trai|\bdot\b", ["BHARTIARTL", "IDEA"], "Telecom regulation"),
    (r"pharma|usfda|drug price|nppa", ["SUNPHARMA", "CIPLA", "DRREDDY"], "Pharma regulation"),
    (r"real estate|housing|stamp duty|rera", ["DLF", "GODREJPROP", "LODHA"], "Real estate policy"),
    (r"railway|rail budget|vande bharat|metro", ["IRCTC", "RVNL", "IRFC"], "Railway capex"),
    (r"sebi|margin|f&o|\bstt\b|market regulator", ["BSE", "ANGELONE", "CDSL"], "Market regulation"),
    (r"monsoon|\bmsp\b|fertili[sz]er|rural|agri", ["COROMANDEL", "CHAMBLFERT", "ESCORTS"], "Agri / rural"),
    (r"sugar|ethanol|\be20\b", ["BALRAMCHIN", "TRIVENI", "PRAJIND"], "Sugar / ethanol"),
]


def impact(items):
    res = []
    for pat, stocks, why in MAP:
        rx = re.compile(pat, re.I)
        hits = [i for i in items if rx.search(i["title"])]
        if not hits:
            continue
        score = sum((1 if POS.search(h["title"]) else 0) - (1 if NEG.search(h["title"]) else 0) for h in hits)
        res.append({"why": why, "stocks": stocks, "hits": hits, "score": score,
                    "weight": len(hits) * 2 + abs(score)})
    res.sort(key=lambda x: x["weight"], reverse=True)
    return res[:3]


def main():
    news = uniq(gnews("Sensex Nifty India stocks market moving") + gnews("India economy data release stocks react"))[:15]

    MACRO = [("CPI inflation", "India CPI retail inflation MoSPI"), ("WPI inflation", "India WPI wholesale inflation"),
             ("PMI", "India manufacturing services PMI HSBC S&P Global"), ("IIP", "India IIP industrial production"),
             ("GDP", "India GDP growth quarter"), ("GST collections", "India GST collections"),
             ("Trade deficit", "India trade deficit exports imports"), ("FPI flows", "FPI FII flows India equities")]
    GOV = [("Cabinet and policy", "India Union Cabinet approves"), ("PIB sector decisions", "site:pib.gov.in ministry scheme sector"),
           ("SEBI rules", "SEBI circular new rules"), ("Duties, PLI and tariffs", "India import duty OR PLI scheme OR anti-dumping notification")]
    RBI = [("RBI official press releases", None), ("Policy and rates", "RBI repo rate MPC governor"),
           ("Liquidity, rupee and banks", "RBI liquidity rupee forex banks")]

    macro = [{"name": n, "items": uniq(gnews(q))[:4]} for n, q in MACRO]
    gov = [{"name": n, "items": uniq(gnews(q))[:6]} for n, q in GOV]
    rbi = [{"name": n, "items": uniq(rbi_official() if q is None else gnews(q))[:6]} for n, q in RBI]

    indices = []
    for sym, name in [("^NSEI", "Nifty 50"), ("^BSESN", "Sensex"), ("^NSEBANK", "Bank Nifty"), ("INR=X", "USD/INR")]:
        q = quote(sym)
        indices.append({"name": name, **(q or {"price": None, "chg": None})})

    pool = uniq(news + [i for m in macro for i in m["items"]] + [i for g in gov for i in g["items"]] + [i for r in rbi for i in r["items"]])
    stocks = []
    for x in impact(pool):
        stocks.append({
            "why": x["why"], "score": x["score"],
            "stocks": [{"sym": s, **(quote(urllib.parse.quote(s, safe="") + ".NS") or {"price": None, "chg": None})} for s in x["stocks"]],
            "hits": x["hits"][:3],
        })

    data = {"generated": datetime.now(timezone.utc).isoformat(), "news": news, "macro": macro, "rbi": rbi, "gov": gov,
            "indices": indices, "wb": {"cpi": world_bank("FP.CPI.TOTL.ZG"), "gdp": world_bank("NY.GDP.MKTP.KD.ZG")},
            "stocks": stocks}
    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("data.json written:", len(news), "news,", len(stocks), "stock themes")


if __name__ == "__main__":
    main()
