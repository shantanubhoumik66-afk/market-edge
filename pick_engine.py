"""Evening pick engine. Runs after market close on GitHub Actions.
Scores news per stock (results, margins, orders, management, legal, brokers),
adds sector effects from global / government / geopolitical news,
picks the top 3 for next day, and tracks its own hit rate in picks_history.json.
Standard library only."""
import json, re, time, urllib.parse
from datetime import datetime, timezone, timedelta
from fetch_data import get, parse_rss

IST = timezone(timedelta(hours=5, minutes=30))
NOW = datetime.now(timezone.utc)

# (symbol, search name, alias regex to confirm headline is about it, sector)
UNIVERSE = [
 ("RELIANCE","Reliance Industries","Reliance",None),("HDFCBANK","HDFC Bank","HDFC Bank","BANK"),
 ("ICICIBANK","ICICI Bank","ICICI Bank","BANK"),("SBIN","State Bank of India","SBI|State Bank","BANK"),
 ("AXISBANK","Axis Bank","Axis Bank","BANK"),("KOTAKBANK","Kotak Mahindra Bank","Kotak","BANK"),
 ("BAJFINANCE","Bajaj Finance","Bajaj Finance","BANK"),("INDUSINDBK","IndusInd Bank","IndusInd","BANK"),
 ("BAJAJFINSV","Bajaj Finserv","Bajaj Finserv","BANK"),("JIOFIN","Jio Financial","Jio Financial","BANK"),
 ("TCS","TCS","TCS|Tata Consultancy","IT"),("INFY","Infosys","Infosys","IT"),
 ("HCLTECH","HCL Technologies","HCL ?Tech","IT"),("WIPRO","Wipro","Wipro","IT"),
 ("TECHM","Tech Mahindra","Tech Mahindra","IT"),("LTIM","LTIMindtree","LTIMindtree","IT"),
 ("MARUTI","Maruti Suzuki","Maruti","AUTO"),("M&M","Mahindra and Mahindra","M&M|Mahindra & Mahindra","AUTO"),
 ("TATAMOTORS","Tata Motors","Tata Motors","AUTO"),("BAJAJ-AUTO","Bajaj Auto","Bajaj Auto","AUTO"),
 ("EICHERMOT","Eicher Motors","Eicher|Royal Enfield","AUTO"),("HEROMOTOCO","Hero MotoCorp","Hero MotoCorp","AUTO"),
 ("BPCL","BPCL","BPCL|Bharat Petroleum","OMC"),("IOC","Indian Oil","Indian Oil|IOC","OMC"),
 ("HINDPETRO","HPCL","HPCL|Hindustan Petroleum","OMC"),("ONGC","ONGC","ONGC","UPSTREAM"),
 ("OIL","Oil India","Oil India","UPSTREAM"),("ASIANPAINT","Asian Paints","Asian Paints","PAINT"),
 ("INDIGO","IndiGo InterGlobe Aviation","IndiGo|InterGlobe","AVIATION"),
 ("TATASTEEL","Tata Steel","Tata Steel","METALS"),("JSWSTEEL","JSW Steel","JSW Steel","METALS"),
 ("HINDALCO","Hindalco","Hindalco","METALS"),("VEDL","Vedanta","Vedanta","METALS"),
 ("COALINDIA","Coal India","Coal India","METALS"),("SUNPHARMA","Sun Pharma","Sun Pharma","PHARMA"),
 ("CIPLA","Cipla","Cipla","PHARMA"),("DRREDDY","Dr Reddy's","Dr\\.? Reddy","PHARMA"),
 ("DIVISLAB","Divi's Laboratories","Divi","PHARMA"),("LUPIN","Lupin","Lupin","PHARMA"),
 ("APOLLOHOSP","Apollo Hospitals","Apollo Hospitals","PHARMA"),
 ("HINDUNILVR","Hindustan Unilever","HUL|Hindustan Unilever","FMCG"),("ITC","ITC","\\bITC\\b","FMCG"),
 ("NESTLEIND","Nestle India","Nestle","FMCG"),("BRITANNIA","Britannia","Britannia","FMCG"),
 ("TATACONSUM","Tata Consumer","Tata Consumer","FMCG"),("NTPC","NTPC","NTPC","POWER"),
 ("POWERGRID","Power Grid","Power Grid","POWER"),("TATAPOWER","Tata Power","Tata Power","POWER"),
 ("ADANIGREEN","Adani Green","Adani Green","POWER"),("ADANIPORTS","Adani Ports","Adani Ports","INFRA"),
 ("LT","Larsen & Toubro","L&T|Larsen","INFRA"),("ULTRACEMCO","UltraTech Cement","UltraTech","INFRA"),
 ("GRASIM","Grasim","Grasim","INFRA"),("HAL","Hindustan Aeronautics","\\bHAL\\b|Hindustan Aeronautics","DEFENCE"),
 ("BEL","Bharat Electronics","\\bBEL\\b|Bharat Electronics","DEFENCE"),("MAZDOCK","Mazagon Dock","Mazagon","DEFENCE"),
 ("BHARTIARTL","Bharti Airtel","Airtel","TELECOM"),("IDEA","Vodafone Idea","Vodafone Idea","TELECOM"),
 ("DLF","DLF","\\bDLF\\b","REALTY"),("GODREJPROP","Godrej Properties","Godrej Properties","REALTY"),
 ("LODHA","Macrotech Developers Lodha","Lodha|Macrotech","REALTY"),("TITAN","Titan Company","\\bTitan\\b",None),
 ("SBILIFE","SBI Life","SBI Life",None),("HDFCLIFE","HDFC Life","HDFC Life",None),
 ("IRCTC","IRCTC","IRCTC",None),("TRENT","Trent Tata","\\bTrent\\b",None),
 ("DMART","Avenue Supermarts DMart","DMart|Avenue Supermarts",None),("PIDILITIND","Pidilite","Pidilite",None),
 ("SWIGGY","Swiggy","Swiggy","NEWAGE"),("ETERNAL","Zomato Eternal","Zomato|Eternal","NEWAGE"),
 ("COLPAL","Colgate-Palmolive India","Colgate","FMCG"),("JINDALSTEL","Jindal Steel and Power","Jindal Steel","METALS"),
 ("PAYTM","Paytm One97","Paytm","NEWAGE"),("NYKAA","Nykaa FSN E-Commerce","Nykaa|FSN","NEWAGE"),
 ("PAGEIND","Page Industries Jockey","Page Industries",None),("DABUR","Dabur","Dabur","FMCG"),
 ("MARICO","Marico","Marico","FMCG"),("GODREJCP","Godrej Consumer","Godrej Consumer","FMCG"),
 ("TATAELXSI","Tata Elxsi","Tata Elxsi","IT"),("PERSISTENT","Persistent Systems","Persistent","IT"),
 ("COFORGE","Coforge","Coforge","IT"),("MPHASIS","Mphasis","Mphasis","IT"),
 ("BANDHANBNK","Bandhan Bank","Bandhan","BANK"),("PNB","Punjab National Bank","PNB|Punjab National","BANK"),
 ("BANKBARODA","Bank of Baroda","Bank of Baroda","BANK"),("CANBK","Canara Bank","Canara","BANK"),
 ("TVSMOTOR","TVS Motor","TVS Motor","AUTO"),("ASHOKLEY","Ashok Leyland","Ashok Leyland","AUTO"),
 ("MOTHERSON","Samvardhana Motherson","Motherson","AUTO"),("SAIL","SAIL Steel Authority","SAIL|Steel Authority","METALS"),
 ("NMDC","NMDC","NMDC","METALS"),("AUROPHARMA","Aurobindo Pharma","Aurobindo","PHARMA"),
 ("ZYDUSLIFE","Zydus Lifesciences","Zydus","PHARMA"),("TORNTPHARM","Torrent Pharma","Torrent Pharma","PHARMA"),
 ("IRFC","IRFC","IRFC",None),("RVNL","Rail Vikas Nigam","RVNL|Rail Vikas",None),
 ("PFC","Power Finance Corporation","Power Finance|\\bPFC\\b","BANK"),("RECLTD","REC Limited","\\bREC\\b","BANK"),
 ("SIEMENS","Siemens India","Siemens",None),("ABB","ABB India","ABB India",None),
 ("HAVELLS","Havells","Havells",None),("POLYCAB","Polycab","Polycab",None),
 ("CHOLAFIN","Cholamandalam Investment","Chola","BANK"),("MUTHOOTFIN","Muthoot Finance","Muthoot","BANK"),
 ("SHRIRAMFIN","Shriram Finance","Shriram Finance","BANK"),("BOSCHLTD","Bosch","Bosch",None),
 ("DIXON","Dixon Technologies","Dixon",None),("INDHOTEL","Indian Hotels","Indian Hotels",None),
 ("JUBLFOOD","Jubilant FoodWorks","Jubilant Food|Domino",None),("UPL","UPL","\\bUPL\\b",None),("SRF","SRF","\\bSRF\\b",None),
]

# ---- company event rules: (regex, weight, label). Positive = up, negative = down ----
EVENTS = [
 (r"(net )?profit (jumps|surges|soars|rises|climbs|up|grows)|pat (up|rises|jumps)|beats? (street )?estimates|better than expected|record (quarterly )?(profit|revenue|sales)|margin (expands?|improves?)", 2.0, "Strong results / margins"),
 (r"(bags?|wins?|secures?|receives?|lands?) .*(order|contract)|order (inflow|win)", 1.6, "Order / contract win"),
 (r"(raises?|hikes?) (guidance|outlook)|guidance (raised|upgrade)", 1.6, "Guidance raised"),
 (r"usfda (approval|nod)|gets? (nod|approval)|clearance", 1.4, "Regulatory approval"),
 (r"buyback|special dividend|bonus issue", 1.2, "Capital return"),
 (r"upgrade[sd]?|target price (raised|hiked)|raises? target|initiates? coverage with buy", 1.2, "Broker upgrade"),
 (r"acquir(es|ed|ition)|strategic partnership|joint venture", 1.0, "Acquisition / partnership"),
 (r"block deal buy|promoter (buys|increases) stake|bulk deal.*buy", 1.0, "Smart-money buying"),
 (r"(net )?profit (falls|drops|declines|slumps|dips|down|plunges)|net loss|loss widens|misses? (street )?estimates|below (street )?estimates|revenue (falls|declines|misses)", -2.0, "Weak results"),
 (r"margin (pressure|contraction|squeeze|declines?|shrinks?|falls)|ebitda margin (falls|declines|dips)", -1.8, "Margin pressure"),
 (r"(ceo|cfo|md|chairman|auditor|director)s? (resigns?|quits?|steps? down|exits?)|resignation", -1.8, "Management exit"),
 (r"fraud|probe|raid|ed (summons|notice)|\bcbi\b|sebi (order|notice|penalty|bans?)|show[- ]cause|insider trading|forensic", -2.2, "Regulatory / legal action"),
 (r"usfda (observations|warning|import alert)|form 483|plant (shutdown|fire)|recall", -1.8, "USFDA / plant issue"),
 (r"downgrade[sd]?|target price (cut|slashed|lowered)|cuts? target|sell rating", -1.2, "Broker downgrade"),
 (r"tax (demand|notice)|penalty|fined|default|debt (stress|concern)|rating (cut|downgrade)|pledge", -1.4, "Tax / debt / penalty"),
 (r"block deal sell|promoter (sells|pledges|dilutes)|stake sale|offer for sale|\bofs\b", -1.0, "Supply / stake sale"), (r"loss(es)? (widen|widens|widened|deepen)|widening loss|cash burn|quick[- ]commerce loss", -2.2, "Losses widening"),
 (r"ebitda (margin )?(miss|missed|misses|below)|margin miss|(miss|misses|missed).{0,25}margin|below consensus", -2.0, "Margin / EBITDA miss"),
 (r"(advertising|marketing|a&p|ad) (spend|expenses?|costs?) (surge|jump|rise|soar|up)", -1.4, "Higher ad spend"),
 (r"(coking coal|input|raw material|freight|logistics|commodity) (cost|prices?).{0,30}(pressure|rise|surge|higher|elevated|squeeze)|cost pressure", -1.4, "Cost pressure"),
 (r"sequential(ly)? (decline|fall|drop|dip)|(profit|ebitda) (falls|declines|drops) (sequentially|qoq|q-o-q)|qoq (decline|fall)", -1.6, "Sequential profit decline"),
 (r"(cuts?|lowers?|slashes?) (guidance|outlook|forecast)|guidance cut", -1.8, "Guidance cut"),
 (r"(demand|volume) (slowdown|weakness|decline|falls?|drops?)|weak demand", -1.4, "Weak demand"),
 (r"(ebitda|margin) beat|beats? consensus|volume growth|price hikes? (boost|help)", 1.6, "Beat / volume growth"),
 (r"merger|demerger|amalgamation|takeover bid", 0.8, "Merger / restructuring"),
]
EVENTS = [(re.compile(p, re.I), w, l) for p, w, l in EVENTS]

# ---- sector effects from global / government news: (regex, {sector: direction}, weight, label) ----
OVERLAY = [
 (r"(crude|brent|oil prices?).{0,25}(surge|jump|spike|rise|climb|rally|soar)", {"OMC":-1,"PAINT":-1,"AVIATION":-1,"UPSTREAM":1}, 1.0, "Crude oil rising"),
 (r"(crude|brent|oil prices?).{0,25}(fall|drop|slump|plunge|slide|tumble)", {"OMC":1,"PAINT":1,"AVIATION":1,"UPSTREAM":-1}, 1.0, "Crude oil falling"),
 (r"\bwar\b|missile|airstrike|escalat|border tension|military", {"DEFENCE":1}, 0.8, "Geopolitical tension"),
 (r"defen[cs]e (order|procurement|deal|contract)|dac approves", {"DEFENCE":1}, 1.0, "Defence orders / approvals"),
 (r"fed.{0,15}(cuts?|dovish)|rate cut by (the )?fed", {"IT":1,"NEWAGE":1}, 0.7, "Fed easing / lower yields"),
 (r"fed.{0,15}(hikes?|hawkish)|yields? (surge|jump|spike)", {"IT":-1,"NEWAGE":-1}, 0.7, "Fed tightening / yields up"),
 (r"rupee (falls|weakens|slumps|hits record low)", {"IT":1,"PHARMA":1}, 0.6, "Rupee weakening"),
 (r"rupee (gains|strengthens|rallies|rises)", {"IT":-1,"PHARMA":-1}, 0.6, "Rupee strengthening"),
 (r"anti-dumping duty|safeguard duty|import duty on steel", {"METALS":1}, 0.9, "Steel import duties"),
 (r"(copper|metal|steel|aluminium) prices? (rise|surge|jump|rally)|china stimulus", {"METALS":1}, 0.8, "Metals prices rising"),
 (r"(copper|metal|steel|aluminium) prices? (fall|drop|slump|slide)|china slowdown", {"METALS":-1}, 0.8, "Metals prices falling"),
 (r"gst (rate )?(cut|reduction)", {"AUTO":1,"FMCG":1}, 0.9, "GST cut"),
 (r"(ev|electric vehicle) (subsidy|incentive|scheme)", {"AUTO":1}, 0.8, "EV incentives"),
 (r"repo rate cut|cuts? repo|rbi cuts?", {"REALTY":1,"AUTO":1,"BANK":1}, 0.9, "RBI rate cut"),
 (r"repo rate hike|hikes? repo|rbi hikes?", {"REALTY":-1,"AUTO":-1}, 0.9, "RBI rate hike"),
 (r"windfall tax (cut|withdrawn|scrapped|removed)", {"UPSTREAM":1}, 1.0, "Windfall tax relief"),
 (r"windfall tax (imposed|hiked|raised)", {"UPSTREAM":-1}, 1.0, "Windfall tax"),
 (r"tariff hike|spectrum (auction|allocation)", {"TELECOM":1}, 0.7, "Telecom tariff / spectrum"),
 (r"(deficient|below[- ]normal) monsoon|drought", {"FMCG":-1,"AUTO":-1}, 0.7, "Weak monsoon"),
 (r"(good|above[- ]normal|normal) monsoon", {"FMCG":1,"AUTO":1}, 0.6, "Good monsoon"),
]
OVERLAY = [(re.compile(p, re.I), s, w, l) for p, s, w, l in OVERLAY]
GLOBAL_QUERIES = ["crude oil prices Brent", "US Federal Reserve interest rates", "Middle East war geopolitical tension",
                  "rupee dollar forex", "China economy metals prices", "US Treasury yields", "India cabinet approves policy",
                  "India import duty anti-dumping", "RBI repo rate", "monsoon India", "defence ministry contract India",
                  "India GST council decision"]


TRUSTED = re.compile(r"reuters|bloomberg|economic times|business standard|mint|livemint|moneycontrol|cnbc|financial express|businessline|business line|ndtv profit|business today|bq prime|bqprime|zee business|the hindu|hindustan times|financial times|wsj|wall street journal|pti|press trust|pib|rbi|nse|bse|sebi", re.I)


def src_mult(src):
    return 1.0 if TRUSTED.search(src or "") else 0.4


def news(q):
    url = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(q + " when:2d") + "&hl=en-IN&gl=IN&ceid=IN:en")
    try:
        return parse_rss(get(url))
    except Exception as e:
        print("news failed:", q, e)
        return []


def fresh(iso):
    h = (NOW - datetime.fromisoformat(iso)).total_seconds() / 3600
    return 1.0 if h <= 12 else 0.75 if h <= 24 else 0.5 if h <= 48 else 0.0


def series(sym, suffix=".NS", rng="3mo"):
    """Daily closes and volumes: list of (IST date, close, volume)."""
    path = "/v8/finance/chart/" + urllib.parse.quote(sym, safe="") + suffix + "?interval=1d&range=" + rng
    for host in ("query1", "query2"):
        try:
            j = json.loads(get("https://%s.finance.yahoo.com%s" % (host, path), 15))
            r = j["chart"]["result"][0]
            q = r["indicators"]["quote"][0]
            out = []
            for t, c, v in zip(r["timestamp"], q["close"], q["volume"]):
                if c is not None:
                    out.append((datetime.fromtimestamp(t, IST).strftime("%Y-%m-%d"), c, v or 0))
            return out
        except Exception:
            continue
    return []


def global_overlay():
    hits = {}  # label -> [rule, items]
    for q in GLOBAL_QUERIES:
        for it in news(q):
            f = fresh(it["time"]) * src_mult(it["src"])
            if f == 0:
                continue
            for rx, sec, w, label in OVERLAY:
                if rx.search(it["title"]):
                    hits.setdefault(label, [(sec, w), []])[1].append(it)
        time.sleep(0.3)
    sector, why = {}, {}
    for label, ((sec, w), items) in hits.items():
        n = min(len({i["title"] for i in items}), 3)
        val = w * (1 + 0.3 * (n - 1))
        for s, d in sec.items():
            sector[s] = max(-2.0, min(2.0, sector.get(s, 0) + d * val))
            why.setdefault(s, []).append({"label": label, "dir": d, "item": items[0]})
    return sector, why


def score_stock(sym, name, alias, sector, overlay, why_sector):
    arx = re.compile(alias, re.I)
    best = {}  # label -> (value, item)
    seen_titles = set()
    items = news('"' + name + '"') + news('"' + name + '" results OR profit OR margin OR loss OR downgrade OR probe OR resigns OR order')
    for it in items:
        if it["title"] in seen_titles or not arx.search(it["title"]):
            continue
        seen_titles.add(it["title"])
        f = fresh(it["time"]) * src_mult(it["src"])
        if f == 0:
            continue
        found = None
        for rx, w, label in EVENTS:
            if rx.search(it["title"]) and (found is None or abs(w) > abs(found[0])):
                found = (w, label)
        if not found:
            continue
        val = found[0] * f
        if found[1] not in best or abs(val) > abs(best[found[1]][0]):
            best[found[1]] = (val, it)
    time.sleep(0.3)
    top = sorted(best.items(), key=lambda kv: abs(kv[1][0]), reverse=True)[:3]
    total = sum(v for _, (v, _) in top)
    sign = 1 if total >= 0 else -1
    srcs = {it["src"] for _, (v, it) in top if (v >= 0) == (sign > 0) and src_mult(it["src"]) == 1.0}
    factor = min(1.6, 1 + 0.2 * (max(len(srcs), 1) - 1))
    ev_net = total * factor
    ov = overlay.get(sector, 0) * 0.8 if sector else 0
    reasons = [{"label": l, "title": it["title"], "link": it["link"], "src": it["src"], "time": it["time"]} for l, (v, it) in top]
    sec_reasons = [{"label": w["label"], "title": w["item"]["title"], "link": w["item"]["link"], "src": w["item"]["src"], "time": w["item"]["time"]}
                   for w in why_sector.get(sector, []) if (w["dir"] > 0) == (ov > 0)] if ov else []
    return {"sym": sym, "sector": sector, "net": ev_net + ov, "event_score": round(ev_net, 2), "sector_score": round(ov, 2),
            "sources": len(srcs), "reasons": reasons, "sector_reasons": sec_reasons[:2]}


def evaluate(history):
    today = NOW.astimezone(IST).strftime("%Y-%m-%d")
    for h in history:
        if "result" in h or h["date"] >= today:
            continue
        s = series(h["sym"])
        dates = [d for d, _, _ in s]
        if h["date"] in dates:
            i = dates.index(h["date"])
            if i + 1 < len(s):
                chg = (s[i + 1][1] / s[i][1] - 1) * 100
                h["result"] = {"next_date": s[i + 1][0], "chg": round(chg, 2), "hit": (chg > 0) == (h["dir"] == "UP")}


def sgn(x):
    return 1 if x > 0 else -1 if x < 0 else 0


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def price_layers(ser, nser):
    """Technical, relative-strength and volume/flow layers from daily prices."""
    closes = [c for _, c, _ in ser]
    vols = [v for _, _, v in ser]
    if len(closes) < 25:
        return None
    c, notes = closes[-1], []
    sma20 = sum(closes[-20:]) / 20
    sma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else None
    t = 0.4 if c > sma20 else -0.4
    if sma50:
        t += 0.4 if c > sma50 else -0.4
        if c > sma20 and c > sma50:
            notes.append("uptrend (above 20 and 50-day averages)")
        elif c < sma20 and c < sma50:
            notes.append("downtrend (below 20 and 50-day averages)")
    mom5 = (c / closes[-6] - 1) * 100
    t += clamp(mom5 / 5, -0.6, 0.6)
    avgv = sum(vols[-21:-1]) / 20
    vr = vols[-1] / avgv if avgv else 1.0
    if c > max(closes[-21:-1]) and vr >= 1.3:
        t += 0.8
        notes.append("20-day breakout on volume")
    if c < min(closes[-21:-1]) and vr >= 1.3:
        t -= 0.8
        notes.append("20-day breakdown on volume")
    diffs = [closes[k] - closes[k - 1] for k in range(len(closes) - 14, len(closes))]
    gain = sum(d for d in diffs if d > 0) / 14
    loss = -sum(d for d in diffs if d < 0) / 14
    rsi = 100 - 100 / (1 + gain / loss) if loss else 100
    if rsi > 75:
        t -= 0.4
        notes.append("RSI %d, overbought" % rsi)
    elif rsi < 25:
        t += 0.4
        notes.append("RSI %d, oversold (bounce risk)" % rsi)
    nm = ((nser[-1][1] / nser[-6][1] - 1) * 100) if len(nser) >= 6 else mom5
    rel = clamp((mom5 - nm) / 6, -0.5, 0.5)
    chg = (c / closes[-2] - 1) * 100
    flow = 0.6 * sgn(chg) if vr >= 1.5 and abs(chg) >= 1 else 0.0
    if flow:
        notes.append("volume %.1fx average on a %+.1f%% day" % (vr, chg))
    return {"tech": clamp(t, -2, 2), "rel": rel, "flow": flow, "notes": notes, "vr": vr, "mom5": mom5}


def market_regime(nser):
    if len(nser) < 21:
        return 0
    c, sma = nser[-1][1], sum(x[1] for x in nser[-20:]) / 20
    mom = (c / nser[-6][1] - 1) * 100
    return 1 if (c > sma and mom > 0) else -1 if (c < sma and mom < 0) else 0


def main():
    try:
        history = json.load(open("picks_history.json", encoding="utf-8"))
    except Exception:
        history = []
    evaluate(history)

    overlay, why_sector = global_overlay()
    scored = [score_stock(*u, overlay, why_sector) for u in UNIVERSE]
    ups = sorted([s for s in scored if s["net"] >= 0.6], key=lambda s: s["net"], reverse=True)[:20]
    downs = sorted([s for s in scored if s["net"] <= -0.6], key=lambda s: s["net"])[:20]

    nser = series("^NSEI", suffix="")
    regime = market_regime(nser)

    for c in ups + downs:
        ser = series(c["sym"])
        news_net = c["net"]
        pl = price_layers(ser, nser) if len(ser) >= 25 else None
        if len(ser) >= 3:
            chg = (ser[-1][1] / ser[-2][1] - 1) * 100
            two = (ser[-1][1] / ser[-3][1] - 1) * 100
            avg = sum(v for _, _, v in ser[-21:-1]) / max(1, len(ser[-21:-1]))
            c["today_chg"] = round(chg, 2)
              c["two_day_chg"] = round(two, 2)
            c["vol_ratio"] = round(ser[-1][2] / avg, 2) if avg else None
            c["close"] = round(ser[-1][1], 2)
            c["close_date"] = ser[-1][0]
            if abs(two) > 5 and (two > 0) == (news_net > 0):
                c["exclude"] = True
                c["flag"] = "Moved %.1f%% in 2 sessions, news likely priced in" % two
            elif abs(chg) > 4 and (chg > 0) == (news_net > 0):
                news_net *= 0.6
                c["flag"] = "Already moved %.1f%% today, part of the news may be priced in" % chg
        layers = {"news": round(c["event_score"] * (news_net / c["net"]) if c["net"] else 0, 2),
                  "sector": c["sector_score"],
                  "technical": round(pl["tech"], 2) if pl else 0,
                  "relative": round(pl["rel"], 2) if pl else 0,
                  "flow": round(pl["flow"], 2) if pl else 0,
                  "market": round(0.4 * regime, 2)}
        c["layers"] = layers
        c["tech_notes"] = pl["notes"] if pl else []
        c["net"] = sum(layers.values())
        d = sgn(c["net"])
        c["agree"] = sum(1 for v in layers.values() if v * d > 0.15)
        time.sleep(0.3)

    def confidence(p):
        a, d, t = abs(p["net"]), sgn(p["net"]), p["layers"]["technical"]
        if a >= 3.5 and p["agree"] >= 4 and p["sources"] >= 2 and t * d >= -0.2:
            return "High"
        if a >= 2.5 and p["agree"] >= 3 and t * d >= -0.4:
            return "Medium"
        return "Low" if a >= 1.5 else "Weak signal"

    def finish(lst, direction):
        ranked = sorted([c for c in lst if not c.get("exclude")], key=lambda s: abs(s["net"]), reverse=True)
        out = [c for c in ranked if abs(c["net"]) >= 0.6][:3]
        for p in out:
            p["dir"] = direction
            p["confidence"] = confidence(p)
            p["net"] = round(p["net"], 2)
        return out

    pool = ups + downs
    picks_up = finish([c for c in pool if c["net"] > 0], "UP")
    picks_down = finish([c for c in pool if c["net"] < 0], "DOWN")
    picks = picks_up + picks_down

    today = NOW.astimezone(IST).strftime("%Y-%m-%d")
    history = [h for h in history if h["date"] != today]
    for p in picks:
        history.append({"date": today, "sym": p["sym"], "dir": p["dir"], "net": p["net"], "confidence": p["confidence"]})
    history = history[-400:]
    done = [h for h in history if "result" in h]

    def st(f):
        x = [h for h in done if f(h)]
        return {"total": len(x), "hits": sum(1 for h in x if h["result"]["hit"])}

    stats = {"all": st(lambda h: True), "up": st(lambda h: h["dir"] == "UP"), "down": st(lambda h: h["dir"] == "DOWN"),
             "tiers": {t: st(lambda h, t=t: h.get("confidence") == t) for t in ("High", "Medium", "Low", "Weak signal")}}

    out = {"generated": NOW.isoformat(), "date": today, "picks_up": picks_up, "picks_down": picks_down,
           "stats": stats, "recent": history[-20:][::-1], "scanned": len(UNIVERSE),
           "market_regime": regime, "sector_effects": {k: round(v, 2) for k, v in overlay.items() if abs(v) >= 0.5}}
    json.dump(out, open("picks.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(history, open("picks_history.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("UP:", [(p["sym"], p["confidence"]) for p in picks_up], "DOWN:", [(p["sym"], p["confidence"]) for p in picks_down])


if __name__ == "__main__":
    main()

