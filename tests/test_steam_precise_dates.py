"""Steam Store public release display precision; no HTTP requests."""
import unittest

from scripts.filter_precise_steam_dates_once import screen_precise_games


class SteamPreciseDatesTests(unittest.TestCase):
    def test_hidden_year_and_quarter_placeholders_even_when_raw_day(self):
        games = [
            {"appid": 1846700, "name": "Witchbrook", "release_start": "2026-12-31",
             "release_precision": "day", "followers": 118244},
            {"appid": 3727390, "name": "The Expanse: Osiris Reborn",
             "release_start": "2027-06-30", "release_precision": "day",
             "followers": 11000},
            {"appid": 2769570, "name": "Fable", "release_start": "2027-02-24",
             "release_precision": "day", "followers": 140298},
        ]
        displays = {
            1846700: {"coming_soon_display": "date_year"},
            3727390: {"coming_soon_display": "date_quarter"},
            2769570: {"coming_soon_display": "date_full"},
        }
        visible, vague = screen_precise_games(games, displays)
        self.assertEqual([g["appid"] for g in visible], [2769570])
        self.assertEqual([g["store_release_display"] for g in vague],
                         ["date_year", "date_quarter"])
        self.assertEqual(visible[0]["release_display_precision"], "date_full")
        self.assertEqual(visible[0]["followers"], 140298)
        self.assertEqual(visible[0]["release_start"], "2027-02-24")

    def test_genuine_quarter_end_with_full_day_remains_visible(self):
        visible, vague = screen_precise_games(
            [{"appid": 101, "release_start": "2026-12-31",
              "release_precision": "day", "followers": 5100}],
            {101: {"coming_soon_display": "date_full"}},
        )
        self.assertEqual(len(visible), 1)
        self.assertEqual(vague, [])

    def test_non_day_precision_is_not_upgraded_by_api(self):
        visible, vague = screen_precise_games(
            [{"appid": 102, "release_start": "2026-12-31",
              "release_precision": "year", "followers": 5100}],
            {102: {"coming_soon_display": "date_full"}},
        )
        self.assertEqual(visible, [])
        self.assertEqual(len(vague), 1)


if __name__ == "__main__":
    unittest.main()
