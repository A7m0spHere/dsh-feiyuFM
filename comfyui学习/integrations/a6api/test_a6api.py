import asyncio
import base64
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image


spec = importlib.util.spec_from_file_location("a6api_node", Path(__file__).with_name("__init__.py"))
node = importlib.util.module_from_spec(spec)
spec.loader.exec_module(node)


class Response:
    def __init__(self, status=200, data=None, body=None):
        self.status, self.data, self.body = status, data, body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def json(self):
        return self.data

    async def read(self):
        return self.body


class Session:
    def __init__(self, response, download=None):
        self.response, self.download = response, download
        self.posts, self.gets = [], []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def post(self, url, **kwargs):
        self.posts.append((url, kwargs))
        if isinstance(self.response, Exception):
            raise self.response
        return self.response

    def get(self, url, **kwargs):
        self.gets.append((url, kwargs))
        return self.download


class A6APITest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        path = Path(self.directory.name) / "default"
        path.mkdir()
        self.credential = path / "a6api.secret.json"
        self.credential.write_text(json.dumps({"api_key": "unit-test-secret"}))
        patcher = patch.object(node.folder_paths, "get_user_directory", return_value=self.directory.name)
        patcher.start()
        self.addCleanup(patcher.stop)
        image = Image.new("RGB", (3, 2), (255, 0, 0))
        stream = io.BytesIO()
        image.save(stream, "PNG")
        self.png = stream.getvalue()

    def generate(self, session):
        with patch.object(node.aiohttp, "ClientSession", return_value=session):
            return asyncio.run(node.A6APITextToImage().generate("a cat", "gpt-image-2.5", "1024x1024"))[0]

    def test_base64_image_and_single_model_request(self):
        session = Session(Response(data={"data": [{"b64_json": base64.b64encode(self.png).decode()}]}))
        result = self.generate(session)
        self.assertEqual(tuple(result.shape), (1, 2, 3, 3))
        self.assertEqual(result[0, 0, 0].tolist(), [1.0, 0.0, 0.0])
        self.assertEqual(len(session.posts), 1)
        url, request = session.posts[0]
        self.assertEqual(url, "https://api.a6api.com/v1/images/generations")
        self.assertEqual(request["json"], {"model": "gpt-image-2.5", "prompt": "a cat", "n": 1, "size": "1024x1024"})
        self.assertFalse(request["allow_redirects"])

    def test_image_url_does_not_receive_credential(self):
        session = Session(Response(data={"data": [{"url": "https://images.example.test/signed"}]}), Response(body=self.png))
        self.assertEqual(tuple(self.generate(session).shape), (1, 2, 3, 3))
        self.assertEqual(session.gets, [("https://images.example.test/signed", {})])

    def test_http_failure_does_not_retry_or_disclose_body(self):
        session = Session(Response(status=401, data={"error": "unit-test-secret"}))
        with self.assertRaisesRegex(RuntimeError, "HTTP 401") as error:
            self.generate(session)
        self.assertNotIn("unit-test-secret", str(error.exception))
        self.assertEqual(len(session.posts), 1)
        self.assertEqual(session.gets, [])

    def test_timeout_does_not_retry(self):
        session = Session(TimeoutError())
        with self.assertRaisesRegex(RuntimeError, "未自动重试"):
            self.generate(session)
        self.assertEqual(len(session.posts), 1)

    def test_missing_credentials_prevent_network(self):
        self.credential.unlink()
        session = Session(Response())
        with self.assertRaisesRegex(RuntimeError, "缺少本机 A6API 凭据"):
            self.generate(session)
        self.assertEqual(session.posts, [])

    def test_missing_image_is_not_fabricated(self):
        session = Session(Response(data={"data": []}))
        with self.assertRaisesRegex(RuntimeError, "未返回图片"):
            self.generate(session)
        self.assertEqual(len(session.posts), 1)


if __name__ == "__main__":
    unittest.main()
