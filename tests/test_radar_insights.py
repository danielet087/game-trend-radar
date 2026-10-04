import importlib.util
from copy import deepcopy
from pathlib import Path
from datetime import date, timedelta
import unittest

spec = importlib.util.spec_from_file_location("insights", Path(__file__).parents[1] / "scripts/build_radar_insights.py")
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


def catalog(*rows):
    return {"count": len(rows), "games": list(rows)}


def game(aid=1, **fields):
    return {"appid": aid, "name": "Test", "release_start": "2026-09-01", "followers": 6000,
            "follower_checked_at": "2026-09-01T15:00:00Z", **fields}


def twitch_game(aid=2, **fields):
    return game(aid, followers=812, release_precision="day",
        release_end="2026-09-01", release_time_utc="2026-08-31T17:00:00Z",
        release_timestamp_taipei_date="2026-09-01",
        release_display_precision="date_full", release_date_timezone="Asia/Taipei",
        steam_type="game", sexual_content_screened=True,
        twitch_admission={"schema_version": 1, "method": "twitch_igdb_external_steam_v1",
            "appid": aid, "twitch_game_id": "100", "igdb_id": "200",
            "checked_at": "2026-09-28T00:00:00Z", "source_frontend_commit": "a" * 40,
            "source_enrollment": {"source": "igdb_first_release_date",
                "observed_at": "2026-09-01T00:00:00Z", "viewer_count": 7200, "min_viewers": 7000}},
        **fields)


def twitch_store_authority(**fields):
    return {**twitch_game(2638890), "name": "Onimusha: Way of the Sword",
        "release_start": "2026-09-03", "release_end": "2026-09-03",
        "release_store_date": "2026-09-03", "release_time_utc": "2026-09-04T00:00:00Z",
        "release_timestamp_taipei_date": "2026-09-04", "release_date_conflict": True,
        "release_date_normalization": "steam_taiwan_store_date_authoritative",
        "release_display_provider": "Steam Store appdetails cc=TW l=tchinese",
        "release_date_verified_at": "2026-10-03T13:00:00Z", **fields}


def nintendo_game(igdb_id=1, releases=None, **fields):
    releases = releases or {"NS2": "2026-11-05"}
    codes = [row["platform"] for row in releases] if isinstance(releases, list) else list(releases)
    rows = releases if isinstance(releases, list) else [
        (audited_nintendo_release(release, platform=code) if code == "PS5" else
         {"platform": code, "date": release, "precision": "day", "source": "IGDB"})
        for code, release in releases.items()]
    return {"id": f"igdb:{igdb_id}", "igdb_id": igdb_id, "display_name": "Nintendo game",
            "hypes": 45, "hypes_status": "available", "popularity_status": "qualified",
            "calendar_eligible": True, "sexual_content_screened": True,
            "game_type": "main_game", "platform_data_complete": True,
            "platforms": [{"code": code, "id": M.IGDB_PLATFORMS[code]} for code in codes],
            "releases": rows, **fields}


def nintendo_catalog(*rows, at="2026-10-03T16:40:12Z"):
    start = M.stamp(at).astimezone(M.TAIPEI).date()
    return {"schema_version": 1, "generated_at": at,
            "window": {"start": start.isoformat(), "end": (start + timedelta(days=365)).isoformat(),
                       "end_inclusive": False, "time_zone": "Asia/Taipei"},
            "source": {"provider": "IGDB", "complete": True, "hypes_threshold": 30,
                       "platform_ids_verified": [130, 508]}, "games": list(rows)}


def igdb_catalog(*rows, **fields):
    document = nintendo_catalog(*rows, **fields)
    document["source"]["platform_ids_verified"] = [130, 167, 508]
    return document


def audited_nintendo_release(release="2026-10-08", **fields):
    return {"platform": "NS2", "date": release, "precision": "day", "region": "worldwide",
            "source": "IGDB", "date_basis": "regional_calendar_day", "source_date": release,
            "source_timestamp": int(M.stamp(release + "T00:00:00Z").timestamp()),
            "source_region": "worldwide", "time_zone": "Asia/Taipei", "timestamp_taipei_date": release,
            "timezone_status": "same_calendar_day", "taiwan_release_confirmed": False,
            "official_source_url": None, "official_source_name": None, **fields}


def official_nintendo_release(**fields):
    return audited_nintendo_release(date="2026-10-09", region="taiwan", source="official_registry",
                                    date_basis="taiwan_official_calendar_day", timezone_status="taiwan_official_date",
                                    taiwan_release_confirmed=True, official_source_name="Nintendo 台灣",
                                    official_source_url="https://www.nintendo.com/tw/schedule/", **fields)


class InsightTests(unittest.TestCase):
    def test_verified_store_authority_keeps_calendar_day_and_real_follower_history(self):
        raw = twitch_store_authority()
        before = deepcopy(raw)
        self.assertEqual(list(M.accepted([raw])), ["2638890"])
        baseline = M.update(None, catalog(game()), observed_at="2026-10-03T12:00:00Z")
        changed = M.update(baseline, catalog(game(), raw), observed_at="2026-10-03T13:00:00Z")
        activity, growth = M.projections(changed, date(2026, 10, 3))
        self.assertEqual(activity["events"][0]["date"], "2026-09-03")
        record = changed["records"]["2638890"]
        self.assertEqual(record["release_date"], "2026-09-03")
        self.assertEqual(record["history"][0]["followers"], 812)
        self.assertEqual(next(g for g in growth["games"] if g["appid"] == 2638890)["release_date"], "2026-09-03")
        self.assertEqual(raw, before)

    def test_store_authority_cannot_be_forged_by_missing_proof_or_bad_date_audit(self):
        for fields in [{"release_date_normalization": None}, {"release_display_provider": "Steam Store cc=US"},
                {"release_date_verified_at": None}, {"release_date_verified_at": "2026-10-03T13:00:00"},
                {"release_store_date": None}, {"release_store_date": "2026-09-04"},
                {"release_store_date": "2026-02-30"}, {"release_end": "2026-09-04"},
                {"release_display_precision": "date_month"}, {"release_date_timezone": "UTC"},
                {"release_time_utc": None}, {"release_timestamp_taipei_date": "2026-09-03"},
                {"release_timestamp_taipei_date": None}, {"release_date_conflict": False},
                {"release_date_conflict": "true"}, {"twitch_admission": None},
                {"steam_type": "dlc"}, {"sexual_content_screened": False}, {"followers": "812"},
                {"follower_checked_at": None},
                {"followers": 6000, "twitch_admission": None},
                {"followers": 6000, "sexual_content_screened": False}]:
            with self.subTest(fields=fields):
                self.assertEqual(M.accepted([twitch_store_authority(**fields)]), {})

    def test_verified_twitch_import_records_addition_and_daily_real_followers_history(self):
        first = M.update(None, catalog(game()), observed_at="2026-09-27T00:00:00Z")
        changed = M.update(first, catalog(game(), twitch_game()), observed_at="2026-09-28T00:00:00Z")
        activity, growth = M.projections(changed, date(2026, 9, 28))
        self.assertEqual([row["appid"] for row in activity["events"]], [2])
        self.assertEqual(changed["records"]["2"]["history"][0]["followers"], 812)
        self.assertEqual([row["appid"] for row in growth["games"]], [1, 2])
        again = M.update(changed, catalog(game(), twitch_game()), observed_at="2026-09-28T01:00:00Z")
        self.assertEqual(again, changed)

    def test_low_followers_twitch_import_requires_complete_proof_and_verified_steam_row(self):
        valid = twitch_game()
        self.assertEqual(list(M.accepted([valid])), ["2"])
        bad_proofs = [None, {}, {**valid["twitch_admission"], "appid": 3},
            {**valid["twitch_admission"], "method": "manual"},
            {**valid["twitch_admission"], "source_frontend_commit": "main"}]
        for proof in bad_proofs:
            with self.subTest(proof=proof):
                self.assertEqual(M.accepted([{**valid, "twitch_admission": proof}]), {})
        for fields in [{"steam_type": "dlc"}, {"sexual_content_screened": False},
                {"release_end": "2026-09-02"}, {"release_precision": "month"},
                {"release_display_precision": "month"}, {"release_date_conflict": True},
                {"release_time_utc": "2026-08-31T15:59:59Z"},
                {"release_time_utc": None}, {"release_date_timezone": "UTC"},
                {"release_timestamp_taipei_date": "2026-08-31"},
                {"follower_checked_at": None}, {"followers": None}]:
            with self.subTest(fields=fields):
                self.assertEqual(M.accepted([{**valid, **fields}]), {})
        for fields in [{"viewer_count": 6999}, {"min_viewers": 7001},
                {"source": "steam_recent_release"}, {"qualification": "unverified"},
                {"observed_at": "2026-09-29T00:00:00Z"}]:
            broken = deepcopy(valid)
            broken["twitch_admission"]["source_enrollment"].update(fields)
            self.assertEqual(M.accepted([broken]), {})
        self.assertEqual(M.accepted([game(followers=4999)]), {})
        self.assertEqual(M.accepted([game(followers=3000, recent_source="direct_release")]), {})
        self.assertEqual(list(M.accepted([game(followers=3001, recent_source="direct_release")])), ["1"])
        self.assertEqual(list(M.accepted([game(followers=5000)])), ["1"])

    def test_date_conflict_is_rejected_without_changing_date_only_legacy_support(self):
        self.assertEqual(list(M.accepted([game()])), ["1"])
        for fields in [{"release_end": "2026-09-02"}, {"release_date_conflict": True},
                {"release_timestamp_taipei_date": "2026-08-31"},
                {"release_time_utc": "2026-08-31T15:59:59Z"}]:
            self.assertEqual(M.accepted([game(**fields)]), {})

    def test_baseline_is_not_a_fake_batch_of_new_games_and_repoll_is_idempotent(self):
        first = M.update(None, catalog(game()), observed_at="2026-09-28T00:00:00Z")
        self.assertEqual(first["events"], [])
        again = M.update(first, catalog(game()), observed_at="2026-09-28T02:00:00Z")
        self.assertEqual(first, again)
        self.assertEqual(again["records"]["1"]["history"][0]["at"], "2026-09-01T15:00:00Z")

    def test_real_addition_date_change_and_removed_games(self):
        first = M.update(None, catalog(game()), observed_at="2026-09-27T00:00:00Z")
        changed = M.update(first, catalog(game(release_start="2026-10-01"), game(2)), observed_at="2026-09-28T00:00:00Z")
        self.assertEqual([event["type"] for event in changed["events"]], ["release_date", "added"])
        final = M.update(changed, catalog(game(2)), observed_at="2026-09-28T01:00:00Z")
        activity, growth = M.projections(final, date(2026, 9, 28))
        self.assertEqual([e["appid"] for e in activity["events"]], [2])
        self.assertEqual([g["appid"] for g in growth["games"]], [2])

    def test_taipei_daily_latest_measurement_and_no_filled_days(self):
        first = M.update(None, catalog(game()), observed_at="2026-09-28T00:00:00Z", measurements=[
            {"appid": 1, "at": "2026-09-02T01:00:00Z", "followers": 6200, "source": "steam_community"},
            {"appid": 1, "at": "2026-09-01T18:00:00Z", "followers": 6100, "source": "steam_community"}])
        self.assertEqual([p["followers"] for p in first["records"]["1"]["history"]], [6000, 6200])

    def test_day_30_included_day_31_rejected_and_never_invent_measurement_time(self):
        first = M.update(None, catalog(game()), observed_at="2026-10-03T00:00:00Z", measurements=[
            {"appid": 1, "at": "2026-10-01T01:00:00Z", "followers": 6500, "source": "steam_community"},
            {"appid": 1, "at": "2026-10-02T01:00:00Z", "followers": 6800, "source": "steam_community"},
            {"appid": 1, "at": "2026-10-01T02:00:00Z", "followers": 9000, "source": "third_party"}])
        self.assertEqual(first["records"]["1"]["history"][-1]["followers"], 6500)
        self.assertTrue(M.projections(first, date(2026, 10, 1))[1]["games"][0]["tracking"])
        self.assertFalse(M.projections(first, date(2026, 10, 2))[1]["games"][0]["tracking"])

    def test_missing_or_invalid_observations_are_not_zero_growth(self):
        first = M.update(None, catalog(game(follower_checked_at=None)), observed_at="2026-09-28T00:00:00Z")
        self.assertEqual(first["records"]["1"]["history"], [])
        with self.assertRaises(ValueError):
            M.update(first, {"count": 2, "games": [game()]}, observed_at="2026-09-28T00:00:00Z")


class NintendoInsightTests(unittest.TestCase):
    NOW = "2026-10-04T04:00:00Z"

    def update(self, previous=None, document=None, **kwargs):
        return M.update(previous, catalog(game()), observed_at=self.NOW,
                        nintendo_catalog=document, **kwargs)

    def test_official_taiwan_correction_generates_the_existing_date_change_event_without_mutation(self):
        original = nintendo_game(381222, releases={"NS2": "2026-10-08"}, display_name="沉星之序")
        first = self.update(document=nintendo_catalog(original))
        release = official_nintendo_release()
        corrected = {**original, "releases": [release]}
        document = nintendo_catalog(corrected, at="2026-10-04T03:00:00Z")
        unchanged_input = deepcopy(document)
        state = self.update(first, document)
        changes = [event for event in state["events"] if event["type"] == "release_date"]
        self.assertEqual(len(changes), 1)
        event = changes[0]
        self.assertEqual((event["source"], event["game_id"], event["igdb_id"], event["platforms"]),
                         ("nintendo", "igdb:381222", 381222, ["NS2"]))
        self.assertEqual((event["previous_date"], event["date"], event["at"]),
                         ("2026-10-08", "2026-10-09", document["generated_at"]))
        record = state["nintendo_records"]["igdb:381222"]
        self.assertEqual(record["first_seen_at"], first["nintendo_records"]["igdb:381222"]["first_seen_at"])
        self.assertEqual(record["current_releases"], {"NS2": "2026-10-09"})
        self.assertEqual(document, unchanged_input)
        self.assertEqual(document["games"][0]["releases"][0]["source_date"], "2026-10-08")
        self.assertEqual(state, self.update(state, document))
        activity, _ = M.projections(state, date(2026, 10, 4))
        self.assertEqual(activity["events"][0], event)

    def test_audited_igdb_dates_and_legacy_regional_calendar_dates_remain_accepted(self):
        for release in [audited_nintendo_release(),
                        audited_nintendo_release(source_timestamp=None, timestamp_taipei_date=None,
                                                 timezone_status="date_only"),
                        {"platform": "NS2", "date": "2026-10-08", "precision": "day", "source": "IGDB",
                         "region": "worldwide", "date_basis": "regional_calendar_day"}]:
            with self.subTest(release=release):
                state = self.update(document=nintendo_catalog(nintendo_game(releases=[release])))
                self.assertEqual(state["nintendo_records"]["igdb:1"]["current_releases"], {"NS2": "2026-10-08"})

    def test_unconfirmed_crossday_and_falsely_claimed_taiwan_dates_are_rejected(self):
        mutations = [{"timezone_status": "requires_time_evidence"}, {"timezone_status": "imprecise_date"},
                     {"timezone_status": "date_only"}, {"time_zone": "UTC"}, {"region": "taiwan"},
                     {"taiwan_release_confirmed": True}, {"taiwan_release_confirmed": "false"},
                     {"date": "2026-10-09"}, {"source_date": "2026-10-07"},
                     {"timestamp_taipei_date": "2026-10-09"}, {"source_timestamp": True}]
        crossday = audited_nintendo_release(source_timestamp=int(M.stamp("2026-10-08T20:00:00Z").timestamp()),
                                            timestamp_taipei_date="2026-10-09")
        legacy_false_taiwan = {"platform": "NS2", "date": "2026-10-08", "precision": "day",
                              "source": "IGDB", "region": "taiwan"}
        for release in [*[audited_nintendo_release(**changes) for changes in mutations], crossday, legacy_false_taiwan]:
            with self.subTest(release=release), self.assertRaises(ValueError):
                self.update(document=nintendo_catalog(nintendo_game(releases=[release])))

    def test_official_calendar_dates_require_complete_audit_and_a_safe_official_source(self):
        release = official_nintendo_release()
        for url in ["https://www.nintendo.com/tw/schedule/", "https://asia.sega.com/metaphor/cht/switch2/",
                    "https://www.konami.com/games/castlevania/", "https://www.playtombraider.com/zh-hant/"]:
            with self.subTest(url=url):
                self.update(document=nintendo_catalog(nintendo_game(releases=[{**release, "official_source_url": url}])))
        missing_original = {**release, "source_date": None, "source_timestamp": None, "timestamp_taipei_date": None}
        self.update(document=nintendo_catalog(nintendo_game(releases=[missing_original])))
        mutations = [{"region": "worldwide"}, {"source": "IGDB"}, {"date_basis": "regional_calendar_day"},
                     {"timezone_status": "same_calendar_day"}, {"taiwan_release_confirmed": False},
                     {"taiwan_release_confirmed": "true"}, {"time_zone": "UTC"}, {"official_source_name": ""},
                     {"official_source_url": "javascript:alert(1)"},
                     {"official_source_url": "https://www.nintendo.com.evil.example/tw/"},
                     {"official_source_url": "https://user:password@www.nintendo.com/tw/"},
                     {"official_source_url": "https://www.nintendo.com:8443/tw/"},
                     {"official_source_url": "https://www.igdb.com/games/order-of-the-sinking-star"}]
        for changes in mutations:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.update(document=nintendo_catalog(nintendo_game(releases=[{**release, **changes}])))

    def test_hong_kong_nintendo_official_date_keeps_the_calendar_day_and_activity_identity(self):
        release = {**official_nintendo_release(), "region": "hong_kong", "taiwan_release_confirmed": False,
                   "date_basis": "hong_kong_official_calendar_day", "timezone_status": "hong_kong_official_date",
                   "official_source_name": "Nintendo 香港", "official_source_url": "https://www.nintendo.com/hk/schedule",
                   "official_verified_at": "2026-10-04T15:00:00Z"}
        first = self.update(document=nintendo_catalog(nintendo_game(releases=[release])))
        self.assertEqual(first["nintendo_records"]["igdb:1"]["release_dates"], {"NS2": "2026-10-09"})
        self.assertEqual(first["events"][0]["date"], "2026-10-09")
        self.assertEqual(first["events"][0]["game_id"], "igdb:1")
        for platform in ["NS", "NS2"]:
            for official_source_url in ["https://www.nintendo.com.hk/schedule/", "https://nintendo.com.hk/software/test/",
                                        "https://store.nintendo.com.hk/70010000000001", "https://www.nintendo.com/hk/schedule"]:
                self.assertTrue(M.accepted_nintendo_release_source({**release, "platform": platform,
                                                                   "official_source_url": official_source_url}))
        valid_time = {**release, "official_release_time_utc": "2026-10-08T18:00:00Z"}
        self.assertTrue(M.accepted_nintendo_release_source(valid_time))
        mutations = [{"platform": "PS5"}, {"region": "taiwan"}, {"region": "worldwide"},
                     {"taiwan_release_confirmed": True}, {"taiwan_release_confirmed": None},
                     {"official_source_name": ""}, {"official_verified_at": None},
                     {"official_verified_at": "2026-10-04T15:00:00"}, {"time_zone": "UTC"},
                     {"date_basis": "regional_calendar_day"}, {"source": "IGDB"},
                     {"official_release_time_utc": "2026-10-08T10:00:00Z"},
                     {"official_release_time_utc": "2026-10-08T18:00:00"},
                     {"source_timestamp": True}, {"source_timestamp": 1791493200}]
        invalid_urls = ["https://www.nintendo.com.hk/", "https://www.nintendo.com.hk/index.html",
                        "https://www.nintendo.com/hk/", "https://www.nintendo.com/hk/index.htm",
                        "https://www.nintendo.com/tw/schedule/", "https://www.nintendo.com/us/schedule/",
                        "https://www.nintendo.com.hk.evil.example/schedule/", "https://other.nintendo.com.hk/schedule/",
                        "http://www.nintendo.com.hk/schedule/", "https://user:pass@www.nintendo.com.hk/schedule/",
                        "https://www.nintendo.com.hk:8443/schedule/", "https://www.nintendo.com.hk/schedule/#game",
                        "https://www.nintendo.com.hk/schedule/?date=2026-10-09", "https://ec.nintendo.com/HK/game/",
                        "https://www.nintendo.com.hk:443/schedule/", "https://www.nintendo.com/hk/../tw/schedule",
                        "https://www.nintendo.com/hk/%2e%2e/tw/schedule", "https://www.nintendo.com/hk/%2e%2e%2fus/schedule",
                        "https://www.nintendo.com/hk/%5c../tw/schedule",
                        "https://store.playstation.com/zh-hant-hk/concept/10009999/"]
        for changes in [*mutations, *[{"official_source_url": url} for url in invalid_urls]]:
            with self.subTest(changes=changes):
                self.assertFalse(M.accepted_nintendo_release_source({**release, **changes}))

    def test_first_public_snapshot_uses_source_time_and_namespaced_identity_without_steam_growth(self):
        first = self.update(document=nintendo_catalog(nintendo_game()))
        event = first["events"][0]
        self.assertEqual((event["source"], event["igdb_id"], event["game_id"]), ("nintendo", 1, "igdb:1"))
        self.assertEqual((event["type"], event["platforms"], event["date"]), ("added", ["NS2"], "2026-11-05"))
        self.assertEqual(event["at"], "2026-10-03T16:40:12Z")
        self.assertEqual(first["nintendo_records"]["igdb:1"]["first_seen_at"], event["at"])
        self.assertNotIn("appid", event)
        activity, growth = M.projections(first, date(2026, 10, 4))
        self.assertEqual(activity["events"], [event])
        self.assertEqual([row["appid"] for row in growth["games"]], [1])
        self.assertNotIn("history", first["nintendo_records"]["igdb:1"])

    def test_incomplete_other_platform_metadata_does_not_override_public_native_qualification(self):
        state = self.update(document=nintendo_catalog(nintendo_game(platform_data_complete=False)))
        self.assertEqual(state["events"][0]["platforms"], ["NS2"])

    def test_published_receipt_is_used_for_actual_addition_day_across_midnight(self):
        source = nintendo_catalog(nintendo_game(), at="2026-10-03T15:59:59Z")
        receipt = {"schema_version": 1, "complete": True, "status": "published",
                   "generated_at": source["generated_at"], "published_at": "2026-10-03T16:00:03Z"}
        first = self.update(document=source, nintendo_receipt=receipt)
        self.assertEqual(first["events"][0]["at"], receipt["published_at"])
        self.assertEqual(first["nintendo_source_at"], source["generated_at"])
        self.assertEqual(M.stamp(first["events"][0]["at"]).astimezone(M.TAIPEI).date(), date(2026, 10, 4))

    def test_invalid_or_mismatched_receipts_never_override_source_time(self):
        source = nintendo_catalog(nintendo_game())
        good = {"schema_version": 1, "complete": True, "status": "published",
                "generated_at": source["generated_at"], "published_at": "2026-10-03T16:40:19Z"}
        for fields in [{"schema_version": True}, {"schema_version": 2}, {"complete": False},
                       {"status": "complete"}, {"generated_at": "2026-10-03T16:40:13Z"},
                       {"published_at": "2026-10-03T16:40:11Z"}, {"published_at": "2026-10-04T05:00:00Z"},
                       {"published_at": "2026-10-04T04:00:00"}, {"published_at": None}]:
            with self.subTest(fields=fields):
                state = self.update(document=source, nintendo_receipt={**good, **fields})
                self.assertEqual(state["events"][0]["at"], source["generated_at"])

    def test_dual_platform_same_date_is_one_event_and_distinct_dates_are_separate(self):
        first = self.update(document=nintendo_catalog(nintendo_game(releases={"NS2": "2026-11-05", "NS": "2026-11-05"})))
        self.assertEqual(len(first["events"]), 1)
        self.assertEqual(first["events"][0]["platforms"], ["NS", "NS2"])
        split = self.update(document=nintendo_catalog(nintendo_game(releases={"NS": "2026-11-05", "NS2": "2026-11-06"})))
        self.assertEqual([(row["date"], row["platforms"]) for row in split["events"]],
                         [("2026-11-05", ["NS"]), ("2026-11-06", ["NS2"])])

    def test_real_platform_addition_and_existing_platform_date_change_are_separate(self):
        first = self.update(document=nintendo_catalog(nintendo_game(releases={"NS": "2026-11-05"})))
        second = self.update(first, nintendo_catalog(nintendo_game(releases={"NS": "2026-11-06", "NS2": "2026-11-07"}),
                                                   at="2026-10-04T02:21:00Z"))
        changes = second["events"][1:]
        self.assertEqual([(row["type"], row["platforms"]) for row in changes],
                         [("release_date", ["NS"]), ("platform_added", ["NS2"])])
        self.assertEqual(changes[0]["previous_date"], "2026-11-05")
        self.assertNotIn("previous_date", changes[1])
        self.assertTrue(all(row["at"] == "2026-10-04T02:21:00Z" for row in changes))
        self.assertEqual(second, self.update(second, nintendo_catalog(nintendo_game(releases={"NS": "2026-11-06", "NS2": "2026-11-07"}),
                                                                      at="2026-10-04T02:21:00Z")))

    def test_same_date_changes_group_only_when_previous_dates_also_match(self):
        first = self.update(document=nintendo_catalog(nintendo_game(releases={"NS": "2026-11-05", "NS2": "2026-11-05"})))
        changed = self.update(first, nintendo_catalog(nintendo_game(releases={"NS": "2026-11-07", "NS2": "2026-11-07"}),
                                                    at="2026-10-04T02:00:00Z"))
        self.assertEqual(len(changed["events"]), 2)
        self.assertEqual(changed["events"][-1]["platforms"], ["NS", "NS2"])
        self.assertEqual(changed["events"][-1]["previous_date"], "2026-11-05")
        separate = self.update(document=nintendo_catalog(nintendo_game(releases={"NS": "2026-11-05", "NS2": "2026-11-06"})))
        changed = self.update(separate, nintendo_catalog(nintendo_game(releases={"NS": "2026-11-07", "NS2": "2026-11-07"}),
                                                       at="2026-10-04T02:00:00Z"))
        self.assertEqual([row["previous_date"] for row in changed["events"][-2:]], ["2026-11-05", "2026-11-06"])

    def test_missing_optional_catalog_preserves_state_and_repoll_never_invents_events(self):
        document = nintendo_catalog(nintendo_game())
        first = self.update(document=document)
        self.assertEqual(first, self.update(first, document))
        self.assertEqual(first, self.update(first))
        later = self.update(first, nintendo_catalog(nintendo_game(), at="2026-10-04T03:00:00Z"))
        self.assertEqual(later["events"], first["events"])

    def test_name_only_localization_updates_existing_activity_without_new_events_or_steam_measurements(self):
        english = nintendo_game(26602, display_name="Metaphor: ReFantazio")
        first = M.update(None, catalog(game()), observed_at="2026-10-04T01:00:00Z",
                         nintendo_catalog=nintendo_catalog(english))
        first = M.update(first, catalog(game(), game(2)), observed_at="2026-10-04T02:00:00Z")
        before = deepcopy(first)
        localized = nintendo_game(26602, display_name="暗喻幻想：ReFantazio",
                                  name_zh_tw="暗喻幻想：ReFantazio", name_en="Metaphor: ReFantazio")
        document = nintendo_catalog(localized, at="2026-10-04T03:00:00Z")
        changed = M.update(first, catalog(game(), game(2)), observed_at=self.NOW,
                           nintendo_catalog=document)

        self.assertEqual(first, before)
        self.assertEqual(changed["records"], first["records"])
        self.assertEqual(changed["events"], first["events"])
        record = changed["nintendo_records"]["igdb:26602"]
        self.assertEqual(record["name"], "暗喻幻想：ReFantazio")
        self.assertEqual(record["first_seen_at"], first["nintendo_records"]["igdb:26602"]["first_seen_at"])
        self.assertEqual(record["release_dates"], first["nintendo_records"]["igdb:26602"]["release_dates"])
        activity, growth = M.projections(changed, date(2026, 10, 4))
        event = next(row for row in activity["events"] if row.get("source") == "nintendo")
        original = next(row for row in first["events"] if row.get("source") == "nintendo")
        self.assertEqual(event, {**original, "name": "暗喻幻想：ReFantazio"})
        self.assertEqual(growth["games"], M.projections(first, date(2026, 10, 4))[1]["games"])
        self.assertEqual(changed, M.update(changed, catalog(game(), game(2)),
                                          observed_at="2026-10-04T05:00:00Z", nintendo_catalog=document))

    def test_removed_and_requalified_games_do_not_repeat_addition(self):
        first = self.update(document=nintendo_catalog(nintendo_game()))
        absent = self.update(first, nintendo_catalog(at="2026-10-04T02:00:00Z"))
        self.assertFalse(absent["nintendo_records"]["igdb:1"]["active"])
        self.assertEqual(M.projections(absent, date(2026, 10, 4))[0]["events"], [])
        returned = self.update(absent, nintendo_catalog(nintendo_game(), at="2026-10-04T03:00:00Z"))
        self.assertEqual(returned["events"], first["events"])
        self.assertEqual(returned["nintendo_records"]["igdb:1"]["first_seen_at"], first["events"][0]["at"])

    def test_removed_and_restored_platform_is_not_a_second_platform_addition(self):
        first = self.update(document=nintendo_catalog(nintendo_game(releases={"NS": "2026-11-05", "NS2": "2026-11-05"})))
        one = self.update(first, nintendo_catalog(nintendo_game(releases={"NS": "2026-11-05"}), at="2026-10-04T02:00:00Z"))
        restored = self.update(one, nintendo_catalog(nintendo_game(releases={"NS": "2026-11-05", "NS2": "2026-11-05"}),
                                                   at="2026-10-04T03:00:00Z"))
        self.assertEqual(restored["events"], first["events"])

    def test_stale_source_does_not_undo_additions_and_conflicting_same_timestamp_is_rejected(self):
        old = nintendo_catalog(nintendo_game())
        latest = nintendo_catalog(nintendo_game(), nintendo_game(2), at="2026-10-04T03:00:00Z")
        first = self.update(document=latest)
        self.assertEqual(first, self.update(first, old))
        with self.assertRaises(ValueError):
            self.update(first, nintendo_catalog(nintendo_game(), at="2026-10-04T03:00:00Z"))

    def test_invalid_envelope_or_source_timestamp_does_not_mutate_previous(self):
        source = nintendo_catalog(nintendo_game())
        first = self.update(document=source)
        bad = [{"schema_version": True}, {"schema_version": 2}, {"games": None},
               {"generated_at": None}, {"generated_at": "2026-10-03T16:40:12"},
               {"generated_at": "2026-10-04T05:00:00Z"},
               {"source": {**source["source"], "complete": False}},
               {"source": {**source["source"], "provider": "manual"}},
               {"source": {**source["source"], "hypes_threshold": 20}},
               {"source": {**source["source"], "hypes_threshold": 30.0}},
               {"source": {**source["source"], "platform_ids_verified": [84, 508]}},
               {"window": {**source["window"], "end_inclusive": True}},
               {"window": {**source["window"], "time_zone": "UTC"}},
               {"window": {**source["window"], "start": "2026-10-05"}}]
        for fields in bad:
            with self.subTest(fields=fields):
                before = deepcopy(first)
                with self.assertRaises(ValueError):
                    self.update(first, {**source, **fields})
                self.assertEqual(first, before)

    def test_unqualified_rows_dates_and_duplicate_or_colliding_identities_are_rejected(self):
        valid = nintendo_game()
        fields = [{"igdb_id": True}, {"igdb_id": 0}, {"igdb_id": "1"}, {"id": "1"},
                  {"hypes": True}, {"hypes": 29}, {"hypes": "45"}, {"hypes": None},
                  {"hypes_status": "unknown"}, {"popularity_status": "observe"},
                  {"calendar_eligible": False}, {"sexual_content_screened": False},
                  {"game_type": "dlc"}, {"platforms": []},
                  {"platforms": [{"code": "NS2", "id": 130}]},
                  {"platforms": [{"code": "NS2", "id": 508.0}]},
                  {"platforms": [{"code": "PC", "id": 6}]}, {"releases": []}]
        for changes in fields:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.update(document=nintendo_catalog({**valid, **changes}))
        for changes in [{"date": "2026-02-30"}, {"date": "2026-10-03"}, {"date": "2027-10-04"},
                        {"date": "2026-11"}, {"precision": "month"}, {"source": "manual"}, {"platform": "NS"}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.update(document=nintendo_catalog({**valid, "releases": [{**valid["releases"][0], **changes}]}))
        for document in [nintendo_catalog(valid, valid), nintendo_catalog({**valid, "platforms": valid["platforms"] * 2}),
                         nintendo_catalog({**valid, "releases": valid["releases"] * 2})]:
            with self.assertRaises(ValueError):
                self.update(document=document)

    def test_bounded_history_and_projection_age_use_real_instants_not_string_sorting(self):
        state = self.update(document=nintendo_catalog(nintendo_game()))
        steam = {"id": "steam-later", "appid": 1, "type": "added", "name": "Test", "date": "2026-11-05", "at": "2026-10-04T02:00:00Z"}
        nintendo = {**state["events"][0], "id": "nintendo-earlier", "at": "2026-10-04T09:00:00+08:00"}
        state["events"] = [steam, nintendo]
        self.assertEqual([row["id"] for row in M.projections(state, date(2026, 10, 4))[0]["events"]],
                         ["steam-later", "nintendo-earlier"])
        merged = self.update(state)
        self.assertEqual([row["id"] for row in merged["events"]], ["nintendo-earlier", "steam-later"])
        activity, _ = M.projections(merged, date(2026, 10, 4))
        self.assertEqual([row["id"] for row in activity["events"]], ["steam-later", "nintendo-earlier"])
        self.assertEqual(merged["events"][0]["at"], "2026-10-04T09:00:00+08:00")
        self.assertEqual(M.projections(merged, date(2026, 10, 3))[0]["events"], [])
        self.assertEqual(len(M.projections(merged, date(2026, 10, 18))[0]["events"]), 2)
        self.assertEqual(M.projections(merged, date(2026, 10, 19))[0]["events"], [])
        state["events"] = [{**steam, "id": str(index)} for index in range(251)]
        merged = self.update(state)
        self.assertEqual(len(merged["events"]), 250)
        self.assertEqual(len(M.projections(merged, date(2026, 10, 4))[0]["events"]), 40)

    def test_ps5_addition_preserves_nintendo_first_seen_history_and_does_not_repeat_old_events(self):
        original = nintendo_game(381222, releases={"NS2": "2026-11-05"}, display_name="跨平台遊戲")
        first = self.update(document=nintendo_catalog(original))
        updated = nintendo_game(381222, releases={"NS2": "2026-11-05", "PS5": "2026-12-12"},
                                display_name="跨平台遊戲")
        document = igdb_catalog(updated, nintendo_game(42, releases={"PS5": "2026-12-01"}),
                                at="2026-10-04T03:00:00Z")
        receipt = {"schema_version": 1, "complete": True, "status": "published",
                   "generated_at": document["generated_at"], "published_at": "2026-10-04T03:01:00Z"}
        state = self.update(first, document, nintendo_receipt=receipt)
        self.assertEqual(state["events"][:1], first["events"])
        self.assertEqual([(event["game_id"], event["type"], event["platforms"])
                          for event in state["events"][1:]],
                         [("igdb:381222", "platform_added", ["PS5"]), ("igdb:42", "added", ["PS5"])])
        self.assertEqual(state["nintendo_records"]["igdb:381222"]["first_seen_at"],
                         first["nintendo_records"]["igdb:381222"]["first_seen_at"])
        self.assertTrue(state["nintendo_records"]["igdb:381222"]["active"])
        self.assertEqual(state["events"][-1]["at"], receipt["published_at"])
        self.assertEqual(state, self.update(state, document, nintendo_receipt=receipt))
        activity, growth = M.projections(state, date(2026, 10, 4))
        self.assertEqual(len(activity["events"]), 3)
        self.assertEqual(growth["games"], M.projections(first, date(2026, 10, 4))[1]["games"])

    def test_ps5_native_platform_requires_verified_source_identity_and_existing_qualification_rules(self):
        ps5 = nintendo_game(42, releases={"PS5": "2026-12-01"})
        with self.assertRaises(ValueError):
            self.update(document=nintendo_catalog(ps5))
        self.assertEqual(self.update(document=igdb_catalog(ps5))["events"][0]["platforms"], ["PS5"])
        for values in [[167, 130, 508], [130, 508, 167]]:
            document = igdb_catalog(ps5)
            document["source"]["platform_ids_verified"] = values
            self.assertEqual(self.update(document=document)["events"][0]["platforms"], ["PS5"])
        for values in [[130, 167, 167], [130, 508, "167"], [130, 508, 167.0], [130, 508, 169]]:
            document = igdb_catalog(ps5)
            document["source"]["platform_ids_verified"] = values
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.update(document=document)
        for changes in [{"hypes": 29}, {"sexual_content_screened": False},
                        {"calendar_eligible": False}, {"game_type": "dlc"},
                        {"platforms": [{"code": "PS5", "id": 130}]},
                        {"platforms": [{"code": "PS5", "id": 167.0}]},
                        {"releases": [{**ps5["releases"][0], "date": "2027-10-04"}]},
                        {"releases": [{**ps5["releases"][0], "precision": "month"}]}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.update(document=igdb_catalog({**ps5, **changes}))

    def test_ps5_taiwan_official_date_proof_is_platform_scoped_and_malformed_urls_are_rejected(self):
        release = {**official_nintendo_release(), "platform": "PS5", "official_source_name": "PlayStation 台灣",
                   "official_source_url": "https://store.playstation.com/zh-hant-tw/concept/1001",
                   "official_product_id": None, "official_concept_id": "1001",
                   "official_release_time_utc": "2026-10-08T18:00:00Z",
                   "official_verified_at": "2026-10-04T02:00:00Z"}
        for url in [release["official_source_url"], "https://www.playstation.com/zh-hant-tw/games/game/"]:
            self.update(document=igdb_catalog(nintendo_game(releases=[{**release, "official_source_url": url}])))
        for url in ["https://www.nintendo.com/tw/schedule/", "https://playstation.com.evil.example/",
                    "https://user:password@store.playstation.com/zh-hant-tw/",
                    "https://store.playstation.com:8443/zh-hant-tw/", "https://store.playstation.com:bad/",
                    "https://store.playstation.com/zh-hant-hk/concept/1001",
                    "https://www.playstation.com/en-us/games/game/", "https://blog.playstation.com/2026/10/04/game/",
                    "https://www.playstation.com/zh-hant-tw/", "https://store.playstation.com/zh-hant-tw/concept/1001?x=1",
                    "javascript:alert(1)", "http://www.playstation.com/zh-hant-tw/"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.update(document=igdb_catalog(nintendo_game(releases=[{**release, "official_source_url": url}])))
        with self.assertRaises(ValueError):
            self.update(document=igdb_catalog(nintendo_game(releases=[{**release, "platform": "NS2"}])))
        for changes in [{"official_concept_id": "1002"}, {"official_concept_id": None}, {"official_product_id": "1001"},
                        {"official_release_time_utc": None}, {"official_release_time_utc": "2026-10-08T15:00:00Z"},
                        {"official_release_time_utc": "2026-10-08T18:00:00"},
                        {"official_verified_at": None}, {"official_verified_at": "2026-10-04T02:00:00"},
                        {"official_source_name": ""}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.update(document=igdb_catalog(nintendo_game(releases=[{**release, **changes}])))
        with self.assertRaises(ValueError):
            self.update(document=igdb_catalog(nintendo_game(releases=[{
                "platform": "PS5", "date": "2026-12-01", "precision": "day", "source": "IGDB"}])))


if __name__ == "__main__":
    unittest.main()
