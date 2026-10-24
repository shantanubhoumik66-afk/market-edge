"""Backtest of the engine's price-based layers (technical, relative strength, volume/flow, market regime)
over about 5 years of daily data, replaying every past day using only data available up to that day.

The news layers cannot be backtested with free data: free feeds keep only a few days of headlines, and using
today's knowledge of old news would give fake results. News is tested live through picks_history.json instead.
Standard library only."""
import json, time, urllib.parse
from datetime import datetime, timezone
from statistics import mean, median, pstdev
from fetch_data import get
from pick_engine import UNIVERSE, price_layers, market_regime, sgn, IST

COST = 0.10      # percent per trade (brokerage, taxes, slippage), subtracted from every trade
TOP_N = 3        # picks per side per day, same as the live engine


def load(sym, suffix=".NS", rng="5y"):
    path = "/v8/finance/chart/" + urllib.parse.quote(sym, safe="") + suffix + "?interval=1d&range=" + rng
    for host in ("query1", "query2"):
        try:
            j = json.loads(get("https://%s.finance.yahoo.com%s" % (host, path), 25))
            r = j["chart"]["result"][0]
            q = r["indicators"]["quote"][0]
            out = []
            for t, o, c, v in zip(r["timestamp"], q["open"], q["close"], q["volume"]):
                if o is not None and c is not None:
                    out.append((datetime.fromtimestamp(t, IST).strftime("%Y-%m-%d"), o, c, v or 0))
            return out
        except Exception:
            continue
    return []


def tier(score, agree):
    a = abs(score)
    if a >= 2.2 and agree >= 3:
        return "High"
    if a >= 1.5 and agree >= 2:
        return "Medium"
    if a >= 0.8:
        return "Low"
    return None


def summarize(trades, mode):
    """mode: 'cc' = enter at the close, exit next close; 'oc' = enter next open, exit next close."""
    if not trades:
        return {"n": 0}
    rets = []
    for t in trades:
        r = t[mode] * 100 * t["d"]
        rets.append(r - COST)
    wins = [r for r in rets if r > 0]
    losses = [-r for r in rets if r <= 0]
    gross_hits = sum(1 for t in trades if t[mode] * t["d"] > 0)
    return {"n": len(rets), "hit_rate": round(100 * gross_hits / len(rets), 1),
            "avg_net_pct": round(mean(rets), 3), "median_net_pct": round(median(rets), 3),
            "profit_factor": round(sum(wins) / sum(losses), 2) if losses and sum(losses) > 0 else None}


def equity(trades, mode):
    by_day = {}
    for t in trades:
        by_day.setdefault(t["date"], []).append(t[mode] * 100 * t["d"] - COST)
    days = sorted(by_day)
    daily = [mean(by_day[d]) for d in days]
    if not daily:
        return {}
    eq, peak, mdd = 1.0, 1.0, 0.0
    for r in daily:
        eq *= 1 + r / 100
        peak = max(peak, eq)
        mdd = min(mdd, eq / peak - 1)
    sd = pstdev(daily) if len(daily) > 1 else 0
    return {"days": len(daily), "total_return_pct": round((eq - 1) * 100, 1), "max_drawdown_pct": round(mdd * 100, 1),
            "sharpe": round(mean(daily) / sd * (252 ** 0.5), 2) if sd else None}


def main():
    nifty = load("^NSEI", "")
    if len(nifty) < 300:
        raise SystemExit("could not download index history")
    ndates = [x[0] for x in nifty]
    nser = [(d, c, v) for d, o, c, v in nifty]

    stocks = {}
    for sym, *_ in UNIVERSE:
        rows = load(sym)
        if len(rows) >= 200:
            stocks[sym] = (rows, {r[0]: k for k, r in enumerate(rows)})
        time.sleep(0.25)
    print("loaded", len(stocks), "stocks,", len(nifty), "index days")

    trades, up_days, total = [], 0, 0
    for j in range(60, len(nifty) - 1):
        d, dn = ndates[j], ndates[j + 1]
        nslice = nser[j - 59:j + 1]
        regime = market_regime(nslice)
        cands = []
        for sym, (rows, dmap) in stocks.items():
            if d not in dmap or dn not in dmap or dmap[d] < 60:
                continue
            i, i2 = dmap[d], dmap[dn]
            ser = [(r[0], r[2], r[3]) for r in rows[i - 59:i + 1]]
            pl = price_layers(ser, nslice)
            if not pl:
                continue
            layers = [pl["tech"], pl["rel"], pl["flow"], 0.4 * regime]
            score = sum(layers)
            dd = sgn(score)
            if dd == 0:
                continue
            two = (rows[i][2] / rows[i - 2][2] - 1) * 100
            r_cc = rows[i2][2] / rows[i][2] - 1
            r_oc = rows[i2][2] / rows[i2][1] - 1
            total += 1
            up_days += 1 if r_cc > 0 else 0
            if abs(two) > 5 and sgn(two) == dd:      # same rule as the live engine: news/move already priced in
                continue
            agree = sum(1 for v in layers if v * dd > 0.15)
            cands.append({"date": d, "sym": sym, "d": dd, "score": score, "agree": agree, "cc": r_cc, "oc": r_oc})
        for side in (1, -1):
            best = sorted([c for c in cands if c["d"] == side and abs(c["score"]) >= 0.8], key=lambda c: abs(c["score"]), reverse=True)[:TOP_N]
            for c in best:
                c["tier"] = tier(c["score"], c["agree"])
                if c["tier"]:
                    trades.append(c)
        if j % 200 == 0:
            print("day", j, "of", len(nifty), "trades so far", len(trades))

    dates = sorted({t["date"] for t in trades})
    split = dates[int(len(dates) * 0.6)] if dates else None
    ins = [t for t in trades if t["date"] < split]
    oos = [t for t in trades if t["date"] >= split]
    base_up = 100 * up_days / total if total else None

    def block(tr):
        return {"cc": summarize(tr, "cc"), "oc": summarize(tr, "oc")}

    res = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "params": {"cost_pct_per_trade": COST, "picks_per_side_per_day": TOP_N, "stocks": len(stocks),
                   "first_day": ndates[60], "last_day": ndates[-1], "split_date": split},
        "baseline": {"stock_days": total, "pct_days_up": round(base_up, 1) if base_up else None},
        "all": block(trades), "in_sample": block(ins), "out_of_sample": block(oos),
        "up": block([t for t in trades if t["d"] == 1]), "down": block([t for t in trades if t["d"] == -1]),
        "tiers": {k: {"all": block([t for t in trades if t["tier"] == k]), "out_of_sample": block([t for t in oos if t["tier"] == k])}
                  for k in ("High", "Medium", "Low")},
        "equity": {"in_sample": {"cc": equity(ins, "cc"), "oc": equity(ins, "oc")},
                   "out_of_sample": {"cc": equity(oos, "cc"), "oc": equity(oos, "oc")}},
        "caveats": [
            "Price layers only. News layers cannot be backtested with free data and are tested live instead.",
            "Uses today's stock list, so companies that were delisted or fell out of the index are missing (survivorship bias).",
            "Entering at the close ('cc') is not exactly tradable after you see the picks. 'oc' enters at the next open, which is the realistic case.",
            "Short selling is assumed possible for DOWN picks (intraday or futures). Costs are a flat estimate.",
            "Past results do not guarantee future results. The out-of-sample column is the honest one: those days were not used to design the rules."
        ]
    }
    json.dump(res, open("backtest.json", "w", encoding="utf-8"), indent=1)
    print("trades", len(trades), "| all oc:", res["all"]["oc"], "| oos oc:", res["out_of_sample"]["oc"])


if __name__ == "__main__":
    main()
