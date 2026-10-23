import unittest
from unittest.mock import patch
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

class ApiContractTests(unittest.TestCase):
    def setUp(self):
        self.config = patch.dict(server.CONFIG, {"geminiApiKey": "test-key", "togetherApiKey": "test-key"}, clear=True)
        self.config.start()
        self.addCleanup(self.config.stop)

    def test_images_request_compact_base64_without_a_second_download(self):
        with patch.object(server, "post_json", return_value=(200, {"data": [{"b64_json": "aGVsbG8="}]})) as post:
            image = server.generate_image("test fish", "sprite")
        self.assertEqual(image, "data:image/png;base64,aGVsbG8=")
        payload = post.call_args.args[1]
        self.assertEqual(payload["response_format"], "base64")
        self.assertEqual(payload["width"], 512)
        self.assertNotIn("aspect_ratio", payload)
        self.assertIn("api.together.ai", post.call_args.args[0])

    def test_empty_species_response_is_an_error(self):
        data = {"candidates": [{"content": {"parts": [{"text": '{"species": []}'}]}}]}
        with patch.object(server, "post_json", return_value=(200, data)):
            with self.assertRaisesRegex(RuntimeError, "especies"):
                server.generate_species({"producers": 1})

    def test_models_can_be_changed_without_editing_the_server(self):
        server.CONFIG["geminiModel"] = "test-model"
        data = {"candidates": [{"content": {"parts": [{"text": '{"species": [{"name": "Alga", "class": "producer", "traits": {}}]}'}]}}]}
        with patch.object(server, "post_json", return_value=(200, data)) as post:
            server.generate_species({"producers": 1})
        self.assertIn("/test-model:generateContent", post.call_args.args[0])
        self.assertNotIn("?key=", post.call_args.args[0])
        self.assertEqual(post.call_args.args[2]["x-goog-api-key"], "test-key")


class RetryTests(unittest.TestCase):
    def test_transient_and_permanent_errors(self):
        calls = []
        waits = []
        def transient():
            calls.append(1)
            if len(calls) < 3:
                raise server.ApiError("rate limit", 429)
            return "ok"
        self.assertEqual(server.retry_request(transient, sleep=waits.append), "ok")
        self.assertEqual(waits, [1.5, 3.0])
        with self.assertRaises(server.ApiError):
            server.retry_request(lambda: (_ for _ in ()).throw(server.ApiError("key", 401)), sleep=lambda _: self.fail("should not retry"))

if __name__ == "__main__":
    unittest.main()
