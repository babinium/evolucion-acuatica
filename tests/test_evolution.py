import json
import tempfile
import unittest
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
import server

TRAITS = dict(size=5.127, speed=5, attack=0, defense=4, perception=6, fertility=12, metabolism=4, foodEfficiency=6, toxicity=0)
BODY = {"requestId": "new-species-1", "class": "herbivore", "ancestor": {
    "name": "Ancestro", "description": "Especie de origen.", "visualDescription": "Compact blue grazer.", "traits": TRAITS}, "traits": {**TRAITS, "size": 7}}
IDENTITY = {"name": "Aleta de jade", "description": "Herbívoro acorazado.", "visualDescription": "Jade grazer with broad fins."}

def answer(value):
    return {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(value)}}]}

class EvolutionContractTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="evo-evolution-test-")
        self.addCleanup(temporary.cleanup)
        cache = patch.object(server, "generation_cache", server.GenerationCache(temporary.name))
        cache.start(); self.addCleanup(cache.stop)
        config = patch.dict(server.CONFIG, {"aiProvider": "openrouter", "openrouterApiKey": "test-identity-key"}, clear=True)
        config.start(); self.addCleanup(config.stop)

    def test_strict_identity_cached_across_concurrent_requests_and_restart(self):
        with patch.object(server, "post_json", return_value=(200, answer(IDENTITY))) as post:
            with ThreadPoolExecutor(max_workers=3) as pool:
                identities = list(pool.map(lambda _: server.evolve_species(BODY), range(3)))
            self.assertEqual(identities, [IDENTITY] * 3)
            self.assertEqual(post.call_count, 1)
            url, payload, _ = post.call_args.args
            self.assertTrue(url.endswith("chat/completions"))
            self.assertEqual(payload["max_tokens"], 448)
            self.assertFalse(payload["provider"]["allow_fallbacks"])
            self.assertEqual(payload["response_format"]["json_schema"]["schema"]["required"], ["name", "description", "visualDescription"])
            self.assertIn('"size":513', payload["messages"][0]["content"])
            directory = server.generation_cache.directory
            server.generation_cache = server.GenerationCache(directory)
            self.assertEqual(server.evolve_species(BODY), IDENTITY)
            self.assertEqual(post.call_count, 1)
            self.assertNotIn("test-identity-key", next(directory.glob("*.json")).read_text())

    def test_bad_inputs_spend_no_quota(self):
        with patch.object(server, "post_json") as post:
            for body in ({**BODY, "class": "omnivore"}, {**BODY, "requestId": ""}, {**BODY, "ancestor": None},
                         {**BODY, "traits": {}}, {**BODY, "traits": {**TRAITS, "size": float("nan")}}):
                with self.assertRaises(server.ApiError) as error:
                    server.evolve_species(body)
                self.assertEqual(error.exception.status, 400)
            post.assert_not_called()

    def test_invalid_identity_never_triggers_an_image_or_retry(self):
        for identity in ({}, {**IDENTITY, "name": "Ancestro"}, {**IDENTITY, "traits": TRAITS}, {**IDENTITY, "visualDescription": ""}):
            with patch.object(server, "post_json", return_value=(200, answer(identity))) as post:
                with self.assertRaises(server.ApiError) as error:
                    server.evolve_species(BODY)
                self.assertEqual(error.exception.status, 422)
                self.assertEqual(post.call_count, 1)

    def test_provider_error_never_exposes_key_or_retries(self):
        with patch.object(server, "post_json", return_value=(402, {"error": {"message": "bad test-identity-key"}})) as post:
            with self.assertRaises(server.ApiError) as error:
                server.evolve_species(BODY)
            self.assertEqual(error.exception.status, 402)
            self.assertNotIn("test-identity-key", str(error.exception))
            self.assertEqual(post.call_count, 1)

    def test_explicit_google_uses_the_same_contract(self):
        server.CONFIG.clear(); server.CONFIG.update(geminiApiKey="test-key")
        with patch.object(server, "post_json", return_value=(200, {"candidates": [{"content": {"parts": [{"text": json.dumps(IDENTITY)}]}}]})) as post:
            self.assertEqual(server.evolve_species(BODY), IDENTITY)
            self.assertTrue(post.call_args.args[0].endswith(":generateContent"))
            self.assertEqual(post.call_args.args[1]["generationConfig"]["maxOutputTokens"], 512)

if __name__ == "__main__":
    unittest.main()
