import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII='
IMAGE = {'data': [{'b64_json': PNG, 'media_type': 'image/png'}], 'usage': {'cost': 0.0184}}

def specimen(name):
    return {'name': name, 'description': 'Especie de prueba.', 'visualDescription': 'Compact blue aquatic body.',
            'habitat': 'Aguas medias', 'traits': {'size': 5, 'speed': 5, 'attack': 0, 'defense': 4,
            'perception': 6, 'fertility': 12, 'metabolism': 4, 'foodEfficiency': 6, 'toxicity': 0}}

SPECIES = {'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'species': {'producer_1': specimen('Alga')}})}}]}


class OpenrouterTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='evo-openrouter-')
        self.addCleanup(temporary.cleanup)
        config = patch.dict(server.CONFIG, {'aiProvider': 'openrouter', 'openrouterApiKey': 'test-openrouter-key',
                                          'geminiApiKey': 'test-unused-google-key'}, clear=True)
        config.start()
        self.addCleanup(config.stop)
        cache = patch.object(server, 'generation_cache', server.GenerationCache(temporary.name))
        cache.start()
        self.addCleanup(cache.stop)

    def test_strict_slots_enforce_unequal_zero_and_maximum_diet_counts(self):
        for counts in ({'producers': 2, 'herbivores': 1, 'carnivores': 3},
                       {'producers': 1, 'herbivores': 1, 'carnivores': 0},
                       {'producers': 0, 'herbivores': 0, 'carnivores': 1},
                       {'producers': 4, 'herbivores': 4, 'carnivores': 4}):
            slots = {}
            for key, kind in (('producers', 'producer'), ('herbivores', 'herbivore'), ('carnivores', 'carnivore')):
                for i in range(1, counts[key] + 1):
                    slots[f'{kind}_{i}'] = specimen(f'{kind} {i}')
            response = {'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'species': slots})}}]}
            with self.subTest(counts=counts), patch.object(server, 'post_json', return_value=(200, response)) as post:
                result = server.generate_species(counts)
                self.assertEqual(len(result), len(slots))
                for key, kind in (('producers', 'producer'), ('herbivores', 'herbivore'), ('carnivores', 'carnivore')):
                    self.assertEqual(sum(sp['class'] == kind for sp in result), counts[key])
                output = post.call_args.args[1]['response_format']
                self.assertEqual(output['type'], 'json_schema')
                self.assertTrue(output['json_schema']['strict'])
                schema = output['json_schema']['schema']['properties']['species']
                self.assertEqual(schema['required'], list(slots))
                self.assertEqual(list(schema['properties']), list(slots))
                self.assertFalse(schema['additionalProperties'])
                self.assertEqual(post.call_count, 1)

    def test_selected_provider_requires_its_own_key_and_never_falls_back(self):
        status = server.config_status()
        self.assertEqual(status['provider'], 'openrouter')
        self.assertNotIn('test-openrouter-key', json.dumps(status))
        server.CONFIG['openrouterApiKey'] = ''
        self.assertFalse(server.config_status()['canUseAiImages'])
        with patch.object(server, 'post_json') as post:
            with self.assertRaisesRegex(server.ApiError, 'openrouterApiKey'):
                server.generate_image('fish')
            post.assert_not_called()

    def test_dedicated_images_request_one_asset_and_reuse_it(self):
        with patch.object(server, 'post_json', return_value=(200, IMAGE)) as post:
            self.assertEqual(server.generate_image('blue fish'), f'data:image/png;base64,{PNG}')
            server.generate_image('blue fish')
            self.assertEqual(post.call_count, 1)
        url, payload, headers = post.call_args.args
        self.assertEqual(url, 'https://openrouter.ai/api/v1/images')
        self.assertEqual(headers, {'Authorization': 'Bearer test-openrouter-key'})
        self.assertEqual(payload['n'], 1)
        self.assertEqual(payload['resolution'], '1K')
        self.assertFalse(payload['provider']['allow_fallbacks'])
        self.assertIn('#ff00ff', payload['prompt'])
        record = next(server.generation_cache.directory.glob('*.json')).read_text()
        self.assertNotIn('test-openrouter-key', record)
        self.assertEqual(json.loads(record)['usage']['cost'], 0.0184)

    def test_bounded_species_generation_is_cached_until_explicit_refresh(self):
        with patch.object(server, 'post_json', return_value=(200, SPECIES)) as post:
            self.assertEqual(server.generate_species({'producers': 1})[0]['name'], 'Alga')
            server.generate_species({'producers': 1})
            self.assertEqual(post.call_count, 1)
            payload = post.call_args.args[1]
            self.assertEqual(payload['max_tokens'], 576)
            self.assertEqual(payload['response_format']['type'], 'json_schema')
            self.assertTrue(payload['response_format']['json_schema']['strict'])
            self.assertFalse(payload['provider']['allow_fallbacks'])
            self.assertTrue(payload['provider']['require_parameters'])
            server.generate_species({'producers': 1, 'fresh': True})
            self.assertEqual(post.call_count, 2)

    def test_generation_errors_do_not_retry_or_expose_either_key(self):
        for status in (401, 402, 429, 500, 502, 503, 504):
            with self.subTest(status=status), patch.object(server, 'post_json', return_value=(status, {'error': {'message': 'bad test-openrouter-key test-unused-google-key'}})) as post:
                with self.assertRaises(server.ApiError) as error:
                    server.generate_image('fish')
                self.assertEqual(error.exception.status, status)
                self.assertNotIn('test-openrouter-key', str(error.exception))
                self.assertNotIn('test-unused-google-key', str(error.exception))
                self.assertEqual(post.call_count, 1)
        with patch.object(server, 'post_json', return_value=(200, {'error': {'code': 402, 'message': 'No credits'}})):
            with self.assertRaises(server.ApiError) as error:
                server.generate_image('fish')
            self.assertEqual(error.exception.status, 402)

    def test_invalid_or_remote_images_are_never_downloaded_or_regenerated(self):
        for item in ({'url': 'https://untrusted.invalid/image.png'}, {'b64_json': 'bad'}, {'b64_json': 'aGVsbG8='}, {'b64_json': PNG, 'media_type': 'image/svg+xml'}):
            with patch.object(server, 'post_json', return_value=(200, {'data': [item]})) as post:
                with self.assertRaises(server.ApiError) as error:
                    server.generate_image('fish')
                self.assertEqual(error.exception.status, 422)
                self.assertEqual(post.call_count, 1)
        with patch.object(server, 'post_json', return_value=(200, {'data': [{'b64_json': PNG}]})):
            self.assertEqual(server.generate_image('fish'), f'data:image/png;base64,{PNG}')

    def test_empty_species_wrong_counts_and_excessive_sizes_stop_early(self):
        with patch.object(server, 'post_json') as post:
            with self.assertRaises(server.ApiError):
                server.generate_species({})
            server.CONFIG['openrouterImageSize'] = '4K'
            with self.assertRaises(server.ApiError):
                server.generate_image('fish')
            post.assert_not_called()
        good = specimen('Alga')
        for content in ('not JSON', '{"species":[]}', '{"species":[{"name":"Pez","class":"herbivore"}]}',
                        json.dumps({'species': {}}), json.dumps({'species': {'herbivore_1': good}}),
                        json.dumps({'species': {'producer_1': good, 'producer_2': good}}),
                        json.dumps({'species': {'producer_1': {**good, 'traits': {**good['traits'], 'size': 'big'}}}}),
                        json.dumps({'species': {'producer_1': {**good, 'traits': {**good['traits'], 'speed': True}}}}),
                        json.dumps({'species': {'producer_1': {**good, 'visualDescription': ''}}})):
            with patch.object(server, 'post_json', return_value=(200, {'choices': [{'message': {'content': content}}]})) as post:
                with self.assertRaises(server.ApiError) as error:
                    server.generate_species({'producers': 1})
                self.assertEqual(error.exception.status, 422)
                self.assertEqual(post.call_count, 1)

    def test_truncated_or_refused_species_do_not_retry(self):
        for choice in ({**SPECIES['choices'][0], 'finish_reason': 'length'},
                       {'finish_reason': 'stop', 'message': {'refusal': 'No content'}}):
            with patch.object(server, 'post_json', return_value=(200, {'choices': [choice]})) as post:
                with self.assertRaises(server.ApiError) as error:
                    server.generate_species({'producers': 1})
                self.assertEqual(error.exception.status, 422)
                self.assertEqual(post.call_count, 1)

    def test_legacy_validated_cache_is_reused_without_generating_again(self):
        body = {'producers': 1}
        payload = {'model': 'openai/gpt-4.1-nano',
                   'messages': [{'role': 'user', 'content': server.build_species_prompt(body)}],
                   'temperature': 0.85, 'max_tokens': 576, 'response_format': {'type': 'json_object'},
                   'provider': {'sort': 'price', 'allow_fallbacks': False, 'require_parameters': True}}
        previous = [{'name': 'Alga anterior', 'class': 'producer'}]
        server.generation_cache.get_or_create('species', {'provider': 'openrouter', 'payload': payload}, lambda: {'value': previous})
        with patch.object(server, 'post_json', return_value=(200, SPECIES)) as post:
            self.assertEqual(server.generate_species(body), previous)
            post.assert_not_called()
            self.assertEqual(server.generate_species({**body, 'fresh': True})[0]['name'], 'Alga')
            self.assertEqual(server.generate_species(body)[0]['name'], 'Alga')
            self.assertEqual(post.call_count, 1)

    def test_connection_checks_metadata_without_generation(self):
        def response(request, **kwargs):
            data = ({'data': {'limit_remaining': 1}} if request.full_url.endswith('/key') else
                    {'data': [{'id': 'openai/gpt-4.1-nano', 'architecture': {'output_modalities': ['text']}}]}
                    if request.full_url.endswith('/models') else
                    {'endpoints': [{'supported_parameters': {'resolution': {'values': ['1K']}}}]})
            value = MagicMock()
            value.__enter__.return_value.read.return_value = json.dumps(data).encode()
            return value
        with patch.object(server.urllib.request, 'urlopen', side_effect=response) as request:
            self.assertTrue(server.check_provider()['ok'])
            self.assertEqual(request.call_count, 3)
            self.assertTrue(all(call.args[0].data is None for call in request.call_args_list))
            server.CONFIG['openrouterImageSize'] = '512'
            with self.assertRaisesRegex(server.ApiError, 'resolución'):
                server.check_provider()


if __name__ == '__main__':
    unittest.main()
