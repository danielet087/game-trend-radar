"""Summarize the first seven days of each launch and fit the week-later forecast.

A launch is a release, an Early Access start, or an Early Access game's full
release (the last two are separate launches). Its days are counted every 24
hours from where it starts: the launch instant (Steam's release time to the
hour, otherwise 00:00 Taiwan time of the launch day), or earlier when the game
was already streamed at launch level right before it. The site applies the
same start rule (src/features/twitch/launch-model.js); both are checked
against tests/fixtures/launch-start-cases.json.

The forecast keeps, for every launch whose days 7-9 (hours 144-216 after the
start) ended before today (00:00 Taiwan time), the ratio of those days' median
to the median of its first 24 and 48 hours, so it is refitted once a day as
launches complete their first week. Each launch is compared with the past
launches closest to it in size (the median of those same first hours): the
closer half, at least 40. Small launches can lose every viewer by days 7-9,
big ones never did, so a big launch no longer inherits a small one's drop to
zero. The site picks them the same way (src/features/twitch/launch-model.js);
both are checked against tests/fixtures/launch-forecast-cases.json. The
backtest beside it predicts each of those launches only from the launches that
had completed by its own 24th or 48th hour.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import math
from pathlib import Path
from statistics import median

try:
    from scripts.build_radar_insights import day, stamp, write
except ModuleNotFoundError:
    from build_radar_insights import day, stamp, write


TAIPEI = timezone(timedelta(hours=8))
HOUR = 3600
DAY = 24 * HOUR
DAYS = 7
MIN_HOURS = 12
CHINESE_HOT_VIEWERS = 100
CHINESE_HOT_HOURS = 4
CHINESE_INDEPENDENT_SOURCE = "helix_language_filter"
GENRES = {
    "Action": "動作", "Adventure": "冒險", "RPG": "角色扮演", "Strategy": "策略",
    "Simulation": "模擬", "Casual": "休閒", "Racing": "競速", "Sports": "運動",
    "Massively Multiplayer": "大型多人連線",
}
# Launch level before the launch: a quarter of the first 24 hours' median and
# at least 300 viewers; 12 hours in a row below it end the run; at least half
# of the hours from the start to the launch reach it; two weeks at most.
START_SHARE, START_FLOOR, START_GAP, START_DENSITY, START_DAYS = 0.25, 300, 12, 0.5, 14
FORECAST_FLOOR = 50            # first 24 hours below this are not forecast
FORECAST_CHECKPOINTS = (24, 48)
FORECAST_TARGET = (144, 216)   # days 7-9 (1-based) after the start
FORECAST_TARGET_HOURS = 36     # observed hours needed in the target days
FORECAST_MIN_LAUNCHES = 20
FORECAST_SHARE = 0.5           # compared with the closer half of past launches by size,
FORECAST_NEIGHBOURS = 40       # and at least this many (all of them while there are fewer)
THRESHOLDS = (100, 1000, 3000)


def iso(instant):
    return datetime.fromtimestamp(instant, timezone.utc).isoformat().replace("+00:00", "Z")


def taipei_midnight(value):
    released = day(value)
    if released is None:
        return None
    return int(datetime(released.year, released.month, released.day, tzinfo=TAIPEI).timestamp())


def launch_instant(date, exact=None):
    """Steam's release time to the hour within 36 hours of the Taiwan date, else 00:00 Taiwan time."""
    midnight = taipei_midnight(date)
    if midnight is None:
        return None
    moment = stamp(exact) if isinstance(exact, str) else None
    if moment is not None:
        at = int(moment.timestamp())
        if abs(at - midnight) <= 36 * HOUR:
            return at - at % HOUR
    return midnight


def taipei_date(instant):
    return datetime.fromtimestamp(instant, TAIPEI).date().isoformat()


def game_launches(game, steam, facts):
    """[(kind, launch instant, Taiwan date)] for a game: Early Access start and
    full release as two launches, otherwise its release."""
    exact = steam.get("release_time_utc") if steam else None
    launches = game.get("launches") if isinstance(game.get("launches"), dict) else {}
    early = launches.get("early_access") if isinstance(launches.get("early_access"), dict) else None
    if early and taipei_midnight(early.get("date")) is not None:
        started = stamp(((facts or {}).get("early_access") or {}).get("started_at") or "")
        at = launch_instant(early["date"])
        if started is not None and abs(int(started.timestamp()) - at) <= 36 * HOUR:
            at = int(started.timestamp()) - int(started.timestamp()) % HOUR
        elif steam and taipei_midnight(steam.get("release_start")) == at:
            at = launch_instant(early["date"], exact)
        found = [("early_access", at, taipei_date(at))]
        full = launches.get("full_release") if isinstance(launches.get("full_release"), dict) else None
        full_at = launch_instant(full.get("date"), exact) if full else None
        if full_at is not None and full_at > at:
            found.append(("full_release", full_at, taipei_date(full_at)))
        return found
    reference = game.get("release_reference") or {}
    if reference.get("precision") != "day":
        return []
    at = launch_instant(reference.get("date"), exact)
    if at is None:
        return []
    genres = steam.get("genres") if steam else None
    kind = "early_access" if isinstance(genres, list) and "Early Access" in genres else "release"
    # The Taiwan day of the instant: Steam's time can fall on the day after a stale reference date.
    return [(kind, at, taipei_date(at))]


def launch_start(hours, launch_at, now, walk_back=True):
    """(start, basis): the hour the launch's days start and why.

    ``hours`` maps each hour of the game's tracked span to (status, viewers,
    receipt): status is "observed", "absent" (collected without this game) or
    "missing" (no collection)."""
    if not walk_back or now < launch_at + DAY:
        return launch_at, "launch"

    def seen(row):
        return row is not None and row[0] == "observed" and row[1] is not None and row[2] <= now

    first = [hours[at][1] for at in range(launch_at, launch_at + DAY, HOUR) if seen(hours.get(at))]
    if len(first) < MIN_HOURS:
        return launch_at, "launch"
    level = max(START_FLOOR, START_SHARE * median(first))
    start, total, reached, below = None, 0, 0, 0
    for at in range(launch_at - HOUR, launch_at - START_DAYS * DAY - 1, -HOUR):
        row = hours.get(at)
        if row is None:
            break  # before the first tracked hour
        status, viewers, receipt = row
        if status == "missing" or receipt > now:
            continue
        value = 0 if status == "absent" else viewers
        if value is None:
            continue
        total += 1
        if value >= level:
            reached += 1
            below = 0
            if reached / total >= START_DENSITY:
                start = at
        else:
            below += 1
            if below >= START_GAP:
                break
    return (start, "pre_launch") if start is not None else (launch_at, "launch")


def window_median(hours, start, length, now, need):
    values = [hours[at][1] for at in range(start, start + length * HOUR, HOUR)
              if hours.get(at) and hours[at][0] == "observed" and hours[at][1] is not None and hours[at][2] <= now]
    return median(values) if len(values) >= need else None


def chinese_heat(viewers):
    hits = sum(value >= CHINESE_HOT_VIEWERS for value in viewers)
    if hits >= CHINESE_HOT_HOURS:
        return True
    if hits + 24 - len(viewers) < CHINESE_HOT_HOURS:
        return False
    return None


def launch_days(hours, chinese, start, cutoff):
    """The first seven 24-hour days from the start that have ended by the cutoff."""
    daily, zh, sources = [], [], []
    for offset in range(DAYS):
        begin = start + offset * DAY
        closed = begin + DAY <= cutoff
        viewers = [hours[at][1] for at in range(begin, begin + DAY, HOUR)
                   if closed and hours.get(at) and hours[at][0] == "observed" and hours[at][1] is not None]
        regional = [chinese[at] for at in range(begin, begin + DAY, HOUR) if closed and at in chinese]
        daily.append(median(viewers) if len(viewers) >= MIN_HOURS else None)
        zh.append([value for value, _ in regional])
        sources.append({source for _, source in regional})
    curve = {"daily": daily}
    if any(sources):
        curve["audience_regions"] = {"zh": {
            "daily": [median(values) if len(values) >= MIN_HOURS else None for values in zh],
            "heat": [chinese_heat(values) if day_sources else None for values, day_sources in zip(zh, sources)],
            "measurement_sources": [None if not day_sources else next(iter(day_sources)) if len(day_sources) == 1 else "mixed"
                                    for day_sources in sources],
        }}
    return curve


def game_hours(root, game_id, game, slots):
    """Every hour of a game's tracked span: (status, viewers, receipt) and the Chinese-region counts."""
    first, last = stamp(game.get("first_hour") or ""), stamp(game.get("last_hour") or "")
    if first is None or last is None:
        return {}, {}
    chunks = {}
    for month in game.get("months", []):
        chunk = json.loads((root / game_id / f"{month}.json").read_text(encoding="utf-8"))
        if (chunk.get("schema_version") != 1 or chunk.get("timezone") != "Asia/Taipei"
                or chunk.get("game_id") != game_id or chunk.get("month") != month):
            raise ValueError(f"Invalid Twitch launch history for {game_id}/{month}")
        chunks[month] = chunk["hours"]
    hours, chinese = {}, {}
    for at in range(int(first.timestamp()), int(last.timestamp()) + 1, HOUR):
        slot = slots.get(at)
        if slot is None:
            hours[at] = ("missing", None, 0)
            continue
        month, key, receipt, received = slot
        row = chunks.get(month, {}).get(key)
        if not isinstance(row, dict):
            hours[at] = ("absent", None, receipt)
            continue
        if row.get("generated_at") != received:
            # A row from another collection run than the index names is not used.
            hours[at] = ("missing", None, 0)
            continue
        viewers = row.get("viewer_count")
        viewers = viewers if type(viewers) is int and viewers >= 0 else None
        hours[at] = ("observed", viewers, receipt)
        regions = row.get("audience_regions")
        region = regions.get("zh") if isinstance(regions, dict) else None
        if viewers is None or not isinstance(region, dict):
            continue
        count, source = region.get("viewer_count"), region.get("measurement_source")
        if (type(count) is not int or count < 0 or source not in (None, CHINESE_INDEPENDENT_SOURCE)
                or source is None and count > viewers):
            continue
        chinese[at] = (count, source or "global_census")
    return hours, chinese


def closest(samples, base):
    """The past launches (size, ratio) closest in size to ``base``: the closer half, at
    least FORECAST_NEIGHBOURS. Size is compared as a multiple (100 is as close to 50 as
    to 200); ties go to the smaller launch, then the lower ratio."""
    count = max(FORECAST_NEIGHBOURS, math.ceil(len(samples) * FORECAST_SHARE))
    if count >= len(samples):
        return list(samples)
    return sorted(samples, key=lambda sample: (max(sample[0], base) / min(sample[0], base), sample[0], sample[1]))[:count]


def predict(samples, base):
    """Days 7-9 for a launch whose first 24 or 48 hours had median ``base``: the median,
    the 80% range and the chance of each threshold from the closest past launches."""
    ratios = sorted(ratio for _, ratio in closest(samples, base))
    return {"launches": len(ratios), "ratio": quantile(ratios, 0.5),
            "median": base * quantile(ratios, 0.5), "low": base * quantile(ratios, 0.1),
            "high": base * quantile(ratios, 0.9),
            "chances": {threshold: sum(base * ratio >= threshold for ratio in ratios) / len(ratios)
                        for threshold in THRESHOLDS}}


def forecast(observations, trained_through):
    """Ratios of days 7-9 to the first 24 and 48 hours with each launch's size, and how
    a rolling refit would have done."""
    known = [item for item in observations if item["target_end"] <= trained_through]
    model = {"trained_through": iso(trained_through), "launches": len(known), "checkpoints": {},
             "samples": {}, "backtest": {}}
    for checkpoint in FORECAST_CHECKPOINTS:
        usable = sorted((item for item in known if item[checkpoint]), key=lambda item: item["start"])
        model["checkpoints"][str(checkpoint)] = sorted(round(item["target"] / item[checkpoint], 4) for item in usable)
        model["samples"][str(checkpoint)] = sorted([round(item[checkpoint], 1), round(item["target"] / item[checkpoint], 4)]
                                                  for item in usable)
        cases = []
        for item in usable:
            prior = [(other[checkpoint], other["target"] / other[checkpoint]) for other in usable
                     if other is not item and other["target_end"] <= item["start"] + checkpoint * HOUR]
            if len(prior) < FORECAST_MIN_LAUNCHES:
                continue
            guess = predict(prior, item[checkpoint])
            cases.append((guess["median"], item["target"], guess["low"], guess["high"], guess["chances"]))
        if not cases:
            continue
        misses = sorted(abs(math.log10((estimate + 1) / (actual + 1))) for estimate, actual, *_ in cases)
        model["backtest"][str(checkpoint)] = {
            "launches": len(cases),
            "median_miss": round(10 ** median(misses), 2),
            "within_range": round(sum(low <= actual <= high for _, actual, low, high, _ in cases) / len(cases), 2),
            "thresholds": {str(threshold): {
                "reached": sum(actual >= threshold for _, actual, *_ in cases),
                "likely": sum(chances[threshold] >= 0.5 for *_, chances in cases),
                "likely_reached": sum(chances[threshold] >= 0.5 and actual >= threshold for _, actual, *_, chances in cases),
            } for threshold in THRESHOLDS},
        }
    return model


def quantile(ordered, share):
    position = (len(ordered) - 1) * share
    lower = math.floor(position)
    return ordered[lower] + (ordered[math.ceil(position)] - ordered[lower]) * (position - lower)


def build(data_dir):
    root = data_dir / "twitch_series"
    index = json.loads((root / "index.json").read_text(encoding="utf-8"))
    generated = stamp(index.get("generated_at"))
    if index.get("schema_version") != 1 or index.get("timezone") != "Asia/Taipei" or not generated:
        raise ValueError("A valid Twitch series index is required")
    catalog = json.loads((data_dir / "catalog.json").read_text(encoding="utf-8"))
    by_app = {str(game["appid"]): game for game in catalog["games"]}
    facts_path = data_dir / "store_facts.json"
    facts = json.loads(facts_path.read_text(encoding="utf-8")).get("games", {}) if facts_path.is_file() else {}
    slots = {}
    for month, hours in index["months"].items():
        for hour, received in hours.items():
            instant, receipt = stamp(hour), stamp(received)
            if instant and receipt and receipt <= generated and not instant.timestamp() % HOUR:
                slots[int(instant.timestamp())] = (month, hour, int(receipt.timestamp()), received)
    # Days end on whole hours: everything up to the latest collected hour is final.
    cutoff = max((at for at in slots), default=None)
    if cutoff is None:
        return {"schema_version": 2, "generated_at": iso(int(generated.timestamp()) // HOUR * HOUR),
                "genres": GENRES, "games": {}, "forecast": None}
    cutoff += HOUR
    now = int(generated.timestamp())
    data_start = min(slots)
    output, observations = {}, []
    for game_id, game in sorted(index["games"].items()):
        if (game.get("archive_eligible") is not True or not game_id.isascii()
                or not game_id.isdecimal() or game_id.startswith("0") or len(game_id) > 16):
            continue
        appid = str((game.get("release_reference") or {}).get("steam_appid") or "")
        if not appid:
            appid = next((source[6:] for source in game.get("admission_sources", [])
                          if isinstance(source, str) and source.startswith("steam:")), "")
        steam = by_app.get(appid)
        # Upcoming launches stay listed so the page can show same-genre curves before them.
        launches = [launch for launch in game_launches(game, steam, facts.get(appid))
                    if launch[1] >= data_start - START_DAYS * DAY]
        if not launches:
            continue
        hours, chinese = game_hours(root, game_id, game, slots)
        raw_genres = steam.get("genres") if steam else None
        genres = [genre for genre in GENRES if isinstance(raw_genres, list) and genre in raw_genres]
        entries = []
        for kind, launch_at, date in launches:
            start, basis = launch_start(hours, launch_at, now, walk_back=kind != "full_release")
            if genres:
                entries.append({"kind": kind, "date": date, "launch_at": iso(launch_at), "start_at": iso(start),
                                "start_basis": basis, **launch_days(hours, chinese, start, cutoff)})
            first = window_median(hours, start, 24, now, MIN_HOURS)
            target_end = start + FORECAST_TARGET[1] * HOUR
            last = stamp(game.get("last_hour") or "")
            if (first is None or first < FORECAST_FLOOR or start < data_start or target_end > cutoff
                    or last is None or target_end > int(last.timestamp()) + HOUR):
                continue
            target = window_median(hours, start + FORECAST_TARGET[0] * HOUR, FORECAST_TARGET[1] - FORECAST_TARGET[0],
                                   now, FORECAST_TARGET_HOURS)
            second = window_median(hours, start, 48, now, 24)
            if target is not None:
                observations.append({"start": start, "target_end": target_end, "target": target,
                                     24: first, 48: second if second else None})
        if entries:
            output[game_id] = {"genres": genres, "launches": entries}
    today = datetime.fromtimestamp(cutoff - HOUR, TAIPEI).replace(hour=0, minute=0, second=0, microsecond=0)
    return {"schema_version": 2, "generated_at": iso(cutoff), "genres": GENRES, "games": output,
            "forecast": forecast(observations, int(today.timestamp()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    args = parser.parse_args()
    write(args.data_dir / "twitch-launch-curves.json", build(args.data_dir))


if __name__ == "__main__":
    main()
