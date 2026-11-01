"""Unit tests for artisanlib.webmirror module.

Tests WebMirror server functionality:
- Snapshot publishing and caching
- WebSocket handshake (empty message → last snapshot)
- Control command protocol (valid/invalid commands, token validation)
- Error handling (malformed JSON, connection persistence)
"""

import json
from typing import Any, override

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from artisanlib.webmirror import WebMirror


class FakeController:
    """Fake controller that accepts only token 't'."""

    def control(self, _cmd: str, token: str) -> dict[str, Any]:
        if token != 't':
            return {'ok': False, 'error': 'unauthorized'}
        return {'ok': True}


class TestWebMirrorPublish:
    """Test publish() method."""

    def test_publish_produces_valid_json(self) -> None:
        """publish() should produce valid JSON and cache it."""
        controller = FakeController()
        wm = WebMirror(
            port=8080,
            resource_path='/tmp',
            index_path='mirror',
            websocket_path='websocket',
            controller=controller
        )

        snapshot = {
            'state': {'on': True, 'recording': False, 'state': 'off'},
            'curve': {'t': [], 'bt': [], 'et': []},
            'events': []
        }

        wm.publish(snapshot)

        assert wm._last_message is not None
        parsed = json.loads(wm._last_message)
        assert parsed == snapshot


class TestWebMirrorWebSocket(AioHTTPTestCase):
    """Test WebSocket protocol."""

    @override
    async def get_application(self) -> web.Application:
        """Create test application with WebMirror."""
        self.controller = FakeController()
        self.wm = WebMirror(
            port=0,  # port not used in tests
            resource_path='/tmp',
            index_path='mirror',
            websocket_path='websocket',
            controller=self.controller
        )
        return self.wm._app

    async def test_empty_message_returns_snapshot(self) -> None:
        """Empty message should return cached snapshot."""
        # Publish a snapshot first
        snapshot = {'state': {'on': True}, 'curve': {}, 'events': []}
        self.wm.publish(snapshot)

        # Connect WebSocket
        ws = await self.client.ws_connect('/websocket')

        # Send empty message
        await ws.send_str('')

        # Should receive the snapshot
        msg = await ws.receive_json()
        assert msg == snapshot

        await ws.close()

    async def test_valid_control_command(self) -> None:
        """Valid control command should return ack from controller."""
        ws = await self.client.ws_connect('/websocket')

        # Send valid command with valid token
        await ws.send_str(json.dumps({'cmd': 'start', 'token': 't'}))

        # Should receive ack
        msg = await ws.receive_json()
        assert msg == {'ack': 'start', 'ok': True}

        await ws.close()

    async def test_unknown_command(self) -> None:
        """Unknown command should return ok:False with error."""
        ws = await self.client.ws_connect('/websocket')

        # Send unknown command
        await ws.send_str(json.dumps({'cmd': 'unknown', 'token': 't'}))

        # Should receive error
        msg = await ws.receive_json()
        assert msg == {'ok': False, 'error': 'unknown-command'}

        await ws.close()

    async def test_invalid_token(self) -> None:
        """Invalid token should return unauthorized from controller."""
        ws = await self.client.ws_connect('/websocket')

        # Send command with invalid token
        await ws.send_str(json.dumps({'cmd': 'start', 'token': 'wrong'}))

        # Should receive unauthorized
        msg = await ws.receive_json()
        assert msg == {'ack': 'start', 'ok': False, 'error': 'unauthorized'}

        await ws.close()

    async def test_missing_token(self) -> None:
        """Missing token should return bad-message."""
        ws = await self.client.ws_connect('/websocket')

        # Send command without token
        await ws.send_str(json.dumps({'cmd': 'start'}))

        # Should receive bad-message
        msg = await ws.receive_json()
        assert msg == {'ok': False, 'error': 'bad-message'}

        await ws.close()

    async def test_malformed_json(self) -> None:
        """Malformed JSON should return bad-message and keep connection alive."""
        ws = await self.client.ws_connect('/websocket')

        # Send malformed JSON
        await ws.send_str('not json')

        # Should receive bad-message
        msg = await ws.receive_json()
        assert msg == {'ok': False, 'error': 'bad-message'}

        # Connection should still be alive - send another command
        await ws.send_str(json.dumps({'cmd': 'start', 'token': 't'}))
        msg = await ws.receive_json()
        assert msg == {'ack': 'start', 'ok': True}

        await ws.close()
