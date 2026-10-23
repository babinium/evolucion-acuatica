import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check-secrets.py"
spec = importlib.util.spec_from_file_location("secret_check", SCRIPT)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class CredentialGuardTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="evo-secret-test-")
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.key = "AIza" + "k" * 35  # Synthetic, assembled only inside the test.
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Local test")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)

    def check(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=self.root, capture_output=True, text=True)

    def test_an_ignored_local_key_is_allowed_but_a_staged_copy_is_blocked(self):
        (self.root / ".gitignore").write_text("config.local.json\n")
        (self.root / "config.local.json").write_text(json.dumps({"geminiApiKey": self.key}))
        (self.root / "app.js").write_text("// no credentials\n")
        self.git("add", ".gitignore", "app.js")
        self.assertEqual(self.check("--staged").returncode, 0)
        (self.root / "app.js").write_text(self.key)
        self.git("add", "app.js")
        blocked = self.check("--staged")
        self.assertEqual(blocked.returncode, 1)
        self.assertNotIn(self.key, blocked.stdout + blocked.stderr)
        self.assertIn("app.js", blocked.stderr)

    def test_private_files_are_blocked_even_when_force_added_without_a_key(self):
        (self.root / "config.local.json").write_text('{"geminiApiKey":""}')
        self.git("add", "config.local.json")
        self.assertEqual(self.check("--staged").returncode, 1)

    def test_removing_a_key_later_does_not_hide_it_from_history_scan(self):
        (self.root / "app.js").write_text(self.key)
        self.git("add", "app.js")
        self.git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture")
        (self.root / "app.js").write_text("// removed\n")
        self.git("add", "app.js")
        self.git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture cleanup")
        result = self.check("--history")
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(self.key, result.stdout + result.stderr)

    def test_placeholders_are_allowed_and_real_key_shapes_are_still_rejected(self):
        self.assertFalse(guard.has_secret(b'{"geminiApiKey":"PEGA_AQUI_TU_CLAVE"}', []))
        self.assertTrue(guard.has_secret(self.key.encode(), []))
        self.assertTrue(guard.private_path('.ai-cache/image.json'))
        self.assertTrue(guard.private_path('config.local.backup.json'))
        self.assertFalse(guard.private_path('config.local.example.json'))


if __name__ == "__main__":
    unittest.main()
