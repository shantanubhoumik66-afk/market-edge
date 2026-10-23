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
 (r"block deal sell|promoter (sells|pledges|dilutes)|stake sale|offer for sale|\bofs\b", -1.0, "Supply / stake sale"),
]
EVENTS = [(re.compile(p, re.I), w, l) for p, w, l in EVENTS]

# ---- sector effects from global / government news: (regex, {sector: direction}, weight, label) ----
OVERLAY = [
 (r"(crude|brent|oil prices?).{0,25}(surge|jump|spike|rise|climb|rally|soar)", {"OMC":-1,"PAINT":-1,"AVIATION":-1,"UPSTREAM":1}, 1.0, "Crude oil rising"),
 (r"(crude|brent|oil prices?).{0,25}(fall|drop|slump|plunge|slide|tumble)", {"OMC":1,"PAINT":1,"AVIATION":1,"UPSTREAM":-1}, 1.0, "Crude oil falling"),
 (r"\bwar\b|missile|airstrike|escalat|border tension|military", {"DEFENCE":1}, 0.8, "Geopolitical tension"),
 (r"defen[cs]e (order|procurement|deal|contract)|dac approves", {"DEFENCE":1}, 1.0, "Defence orders / approvals"),
 (r"fed.{0,15}(cuts?|dovish)|rate cut by (the )?fed", {"IT":1}, 0.7, "Fed easing"),
 (r"fed.{0,15}(hikes?|hawkish)|yields? (surge|jump|spike)", {"IT":-1}, 0.7, "Fed tightening / yields up"),
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


def series(sym):
    """Daily closes and volumes for the last month: list of (IST date, close, volume)."""
    path = "/v8/finance/chart/" + urllib.parse.quote(sym, safe="") + ".NS?interval=1d&range=1mo"
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
            f = fresh(it["time"])
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
    for it in news('"' + name + '"'):
        if not arx.search(it["title"]):
            continue
        f = fresh(it["time"])
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
    srcs = {it["src"] for _, (v, it) in top if (v >= 0) == (sign > 0)}
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


def main():
    try:
        history = json.load(open("picks_history.json", encoding="utf-8"))
    except Exception:
        history = []
    evaluate(history)

    overlay, why_sector = global_overlay()
    scored = [score_stock(*u, overlay, why_sector) for u in UNIVERSE]
    cands = sorted([s for s in scored if abs(s["net"]) >= 1.0], key=lambda s: abs(s["net"]), reverse=True)[:12]

    for c in cands:
        ser = series(c["sym"])
        if len(ser) >= 2:
            chg = (ser[-1][1] / ser[-2][1] - 1) * 100
            avg = sum(v for _, _, v in ser[-21:-1]) / max(1, len(ser[-21:-1]))
            c["today_chg"] = round(chg, 2)
            c["vol_ratio"] = round(ser[-1][2] / avg, 2) if avg else None
            c["close"] = round(ser[-1][1], 2)
            c["close_date"] = ser[-1][0]
            if abs(chg) > 4 and (chg > 0) == (c["net"] > 0):
                c["net"] *= 0.6
                c["flag"] = "Already moved %.1f%% today, part of the news may be priced in" % chg
        time.sleep(0.3)

    picks = [c for c in sorted(cands, key=lambda s: abs(s["net"]), reverse=True) if abs(c["net"]) >= 1.8][:3]
    for p in picks:
        a = abs(p["net"])
        p["dir"] = "UP" if p["net"] > 0 else "DOWN"
        p["confidence"] = "High" if a >= 4 and p["sources"] >= 2 else "Medium" if a >= 2.8 else "Low"
        p["net"] = round(p["net"], 2)

    today = NOW.astimezone(IST).strftime("%Y-%m-%d")
    history = [h for h in history if h["date"] != today]
    for p in picks:
        history.append({"date": today, "sym": p["sym"], "dir": p["dir"], "net": p["net"], "confidence": p["confidence"]})
    history = history[-200:]
    done = [h for h in history if "result" in h]
    stats = {"total": len(done), "hits": sum(1 for h in done if h["result"]["hit"])}

    out = {"generated": NOW.isoformat(), "date": today, "picks": picks, "stats": stats,
           "recent": history[-15:][::-1], "scanned": len(UNIVERSE),
           "sector_effects": {k: round(v, 2) for k, v in overlay.items() if abs(v) >= 0.5}}
    json.dump(out, open("picks.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(history, open("picks_history.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("picks:", [(p["sym"], p["dir"], p["confidence"]) for p in picks])


if __name__ == "__main__":
    main()
