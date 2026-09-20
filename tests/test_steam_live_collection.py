"""Offline safety checks for the one-off real Steam to Git test."""
import unittest
from unittest.mock import patch

from scripts.collect_live_steam_to_git_once import (
    read_followers, refresh_follower_sample, validate_store_rows,
)


class Response:
    def __init__(self, status_code, text=""):
        self.status_code = status_code
        self.text = text

    def raise_for_status(self):
        if self.status_code >= 400:
            raise ValueError("Unexpected status")


class Session:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requested = []

    def get(self, url, *, params, timeout):
        self.requested.append((url, params, timeout))
        return next(self.responses)


class SteamLiveTests(unittest.TestCase):
    def test_real_xml_member_count(self):
        self.assertEqual(read_followers(
            "<memberList><memberCount>17,796</memberCount></memberList>"), 17796)
        with self.assertRaises(ValueError):
            read_followers("<memberList><memberCount>unknown</memberCount></memberList>")

    def test_only_full_date_passes(self):
        games = [{"appid": 10, "release_display_precision": "date_full"}]
        validate_store_rows(
            games, {10: {"coming_soon_display": "date_full"}}
        )
        with self.assertRaisesRegex(RuntimeError, "no longer exact"):
            validate_store_rows(
                games, {10: {"coming_soon_display": "date_quarter"}}
            )

    def test_two_verified_counts_do_not_touch_input_until_publish(self):
        games = [
            {"appid": 10, "followers": 50001},
            {"appid": 20, "followers": 7001},
        ]
        session = Session([
            Response(200, "<memberList><memberCount>50012</memberCount></memberList>"),
            Response(200, "<memberList><memberCount>7012</memberCount></memberList>"),
        ])
        with patch("scripts.collect_live_steam_to_git_once.time.sleep"):
            result = refresh_follower_sample(session, games, interval=0)
        self.assertEqual([row["status"] for row in result], ["verified", "verified"])
        self.assertEqual(result[0]["new"], 50012)
        self.assertEqual(games[0]["followers"], 50001)
        self.assertEqual(len(session.requested), 2)

    def test_429_stops_pilot_without_inventing_followers(self):
        session = Session([Response(429)])
        with patch("scripts.collect_live_steam_to_git_once.time.sleep"):
            result = refresh_follower_sample(
                session,
                [{"appid": 10, "followers": 6000},
                 {"appid": 20, "followers": 5500}],
                interval=0,
            )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["status"], "rate_limited")
        self.assertIsNone(result[0]["new"])
        self.assertEqual(len(session.requested), 1)

    def test_invalid_small_count_never_enters_published_data(self):
        session = Session([
            Response(200, "<memberList><memberCount>40</memberCount></memberList>")
        ])
        with patch("scripts.collect_live_steam_to_git_once.time.sleep"):
            result = refresh_follower_sample(
                session, [{"appid": 10, "followers": 30000}], interval=0,
            )
        self.assertEqual(result[0]["status"], "unexpected_count_not_published")
        self.assertIsNone(result[0]["new"])


if __name__ == "__main__":
    unittest.main()
