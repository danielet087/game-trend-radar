"""Offline Steam sexual-content exclusion checks; does not call Steam APIs."""
import unittest

from scripts.filter_steam_adult_games_once import filter_rows, reason


class SteamAdultFilterTests(unittest.TestCase):
    def test_explicit_sexual_content_descriptors_excluded(self):
        for descriptors in ([3], [4], [1, 3, 4, 5]):
            self.assertIsNotNone(reason({"content_descriptorids": descriptors}))

    def test_mere_mature_nudity_violence_and_romance_remain(self):
        for descriptors in ([], [1], [2], [5], [1, 2, 5]):
            self.assertIsNone(reason({"content_descriptorids": descriptors}))
        self.assertIsNone(reason({
            "content_descriptorids": [1, 5],
            "tags": [{"tagid": 9130}, {"tagid": 12095}],
            "basic_info": {"short_description": "A multiplayer shooting and brawling game"},
        }))

    def test_strong_sexual_tags_and_explicit_description_without_descriptor(self):
        explicit = {
            "tags": [{"tagid": 12095}, {"tagid": 6650}, {"tagid": 9130}],
            "basic_info": {"short_description": "An NSFW idle game."},
        }
        self.assertIsNotNone(reason(explicit))
        self.assertIsNone(reason({
            "tags": [{"tagid": 12095}, {"tagid": 6650}],
            "basic_info": {"short_description": "Romance and dating in a fantasy city."},
        }))

    def test_only_removes_excluded_rows_without_modifying_others(self):
        normal = {"appid": 1, "followers": 5100, "header_image": "orig",
                  "release_start": "2026-09-21"}
        adult = {"appid": 2, "followers": 6200, "header_image": "orig2",
                 "release_start": "2026-09-23"}
        kept, excluded = filter_rows([normal, adult], {
            1: {"content_descriptorids": [1, 5]},
            2: {"content_descriptorids": [3, 4]},
        })
        self.assertEqual(kept, [normal])
        self.assertIs(kept[0], normal)
        self.assertEqual(excluded[0]["appid"], 2)
        self.assertEqual(normal["header_image"], "orig")


if __name__ == "__main__":
    unittest.main()
