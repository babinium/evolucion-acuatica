import unittest
from unittest.mock import patch, MagicMock
import sys
import json
import threading
import urllib.request
import urllib.error
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII='
def image_response(parts=None):
    return {'candidates': [{'content': {'parts': parts if parts is not None else [{'inlineData': {'mimeType': 'image/png', 'data': PNG}}]}}]}

class ApiContractTests(unittest.TestCase):
    def setUp(self):
        self.config = patch.dict(server.CONFIG, {'geminiApiKey': 'test-key'}, clear=True)
        self.config.start()
        self.addCleanup(self.config.stop)

    def test_one_google_key_enables_both_capabilities(self):
        status = server.config_status()
        self.assertTrue(status['canUseAiImages'])
        self.assertEqual(status['missing'], [])
        self.assertNotIn('test-key', json.dumps(status))
        server.CONFIG.clear()
        self.assertEqual(server.config_status()['missing'], ['geminiApiKey'])

    def test_image_generation_uses_google_and_one_compact_image(self):
        server.CONFIG['geminiImageModel'] = 'test-image-model'
        with patch.object(server, 'post_json', return_value=(200, image_response())) as post:
            image = server.generate_image('blue fish')
        self.assertEqual(image, f'data:image/png;base64,{PNG}')
        url, payload, headers = post.call_args.args
        self.assertTrue(url.endswith('/test-image-model:generateContent'))
        self.assertNotIn('test-key', url)
        self.assertEqual(headers['x-goog-api-key'], 'test-key')
        self.assertEqual(payload['generationConfig'], {'responseModalities': ['IMAGE'], 'imageConfig': {'aspectRatio': '1:1', 'imageSize': '512'}})
        self.assertIn('#ff00ff', payload['contents'][0]['parts'][0]['text'])
        self.assertIn('TOP-DOWN', payload['contents'][0]['parts'][0]['text'])
        self.assertEqual(post.call_args.kwargs['timeout'], 90)

    def test_thought_images_are_ignored(self):
        parts = [{'thought': True, 'inlineData': {'mimeType': 'image/png', 'data': 'bad'}}, {'text': 'ready'}, {'inlineData': {'mimeType': 'image/png', 'data': PNG}}]
        with patch.object(server, 'post_json', return_value=(200, image_response(parts))):
            self.assertEqual(server.generate_image('fish'), f'data:image/png;base64,{PNG}')

    def test_blocked_or_invalid_images_are_not_retried(self):
        for data in [{'promptFeedback': {'blockReason': 'SAFETY'}}, image_response([]), image_response([{'inlineData': {'mimeType': 'image/png', 'data': 'aGVsbG8='}}])]:
            with patch.object(server, 'post_json', return_value=(200, data)) as post:
                with self.assertRaises(server.ApiError) as error:
                    server.generate_image_with_retry('fish')
                self.assertEqual(error.exception.status, 422)
                self.assertEqual(post.call_count, 1)

    def test_invalid_prompt_and_large_image_config_do_not_spend_quota(self):
        with patch.object(server, 'post_json') as post:
            with self.assertRaises(server.ApiError):
                server.generate_image('')
            server.CONFIG['geminiImageSize'] = '4K'
            with self.assertRaises(server.ApiError):
                server.generate_image('fish')
            post.assert_not_called()

    def test_metadata_check_does_not_generate_any_content(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({'supportedGenerationMethods': ['generateContent']}).encode()
        with patch.object(server.urllib.request, 'urlopen', return_value=response) as request:
            self.assertTrue(server.check_google()['ok'])
        self.assertEqual(request.call_count, 2)
        for call in request.call_args_list:
            self.assertIsNone(call.args[0].data)
            self.assertNotIn(':generateContent', call.args[0].full_url)

    def test_provider_errors_do_not_expose_credentials(self):
        with patch.object(server, 'post_json', return_value=(403, {'error': {'message': 'bad test-key'}})):
            with self.assertRaises(server.ApiError) as error:
                server.generate_image('fish')
        self.assertNotIn('test-key', str(error.exception))
        self.assertIn('permisos', str(error.exception))

    def test_empty_and_wrong_diet_species_are_errors(self):
        for species in [[], [{'name': 'Pez', 'class': 'herbivore'}]]:
            data = {'candidates': [{'content': {'parts': [{'text': json.dumps({'species': species})}]}}]}
            with patch.object(server, 'post_json', return_value=(200, data)):
                with self.assertRaisesRegex(RuntimeError, 'especies'):
                    server.generate_species({'producers': 1})

    def test_models_are_configurable_and_text_thoughts_are_ignored(self):
        server.CONFIG['geminiModel'] = 'test-model'
        data = {'candidates': [{'content': {'parts': [{'thought': True, 'text': '{bad}'}, {'text': '{"species": [{"name": "Alga", "class": "producer", "traits": {}}]}'}]}}]}
        with patch.object(server, 'post_json', return_value=(200, data)) as post:
            server.generate_species({'producers': 1})
        self.assertIn('/test-model:generateContent', post.call_args.args[0])
        self.assertNotIn('?key=', post.call_args.args[0])
        self.assertEqual(post.call_args.args[2]['x-goog-api-key'], 'test-key')

class RetryTests(unittest.TestCase):
    def test_transient_and_permanent_errors(self):
        calls, waits = [], []
        def transient():
            calls.append(1)
            if len(calls) < 3:
                raise server.ApiError('rate limit', 429)
            return 'ok'
        self.assertEqual(server.retry_request(transient, sleep=waits.append), 'ok')
        self.assertEqual(waits, [1.5, 3.0])
        with self.assertRaises(server.ApiError):
            server.retry_request(lambda: (_ for _ in ()).throw(server.ApiError('key', 401)), sleep=lambda _: self.fail('should not retry'))


class HttpContractTests(unittest.TestCase):
    def test_python_routes_return_one_image_and_protect_configuration(self):
        class QuietHandler(server.Handler):
            def log_message(self, *args):
                pass
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        worker = threading.Thread(target=http.serve_forever, daemon=True)
        worker.start()
        base = f'http://127.0.0.1:{http.server_port}'
        try:
            with patch.dict(server.CONFIG, {'geminiApiKey': 'test-key'}, clear=True):
                with urllib.request.urlopen(base + '/api/config-status') as response:
                    status = response.read().decode()
                self.assertNotIn('test-key', status)
                self.assertTrue(json.loads(status)['canUseAiImages'])
                for path in ('/config.local.json', '/.git/config'):
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(base + path)
                    self.assertEqual(error.exception.code, 403)
                with patch.object(server, 'post_json', return_value=(200, image_response())) as post:
                    req = urllib.request.Request(base + '/api/generate-images', data=b'{"prompt":"fish"}', headers={'Content-Type': 'application/json'})
                    with urllib.request.urlopen(req) as response:
                        self.assertEqual(json.loads(response.read()), {'image': f'data:image/png;base64,{PNG}'})
                    self.assertEqual(post.call_count, 1)
                    bad = urllib.request.Request(base + '/api/generate-images', data=b'{"prompts":[]}', headers={'Content-Type': 'application/json'})
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(bad)
                    self.assertEqual(error.exception.code, 400)
                    self.assertEqual(post.call_count, 1)
        finally:
            http.shutdown()
            http.server_close()
            worker.join(timeout=2)

if __name__ == '__main__':
    unittest.main()
