#
# WebMirror for artisan scope
#
# COPYRIGHT (C) 2010-2026 The artisan team represented by
#   Marko Luther <marko.luther@gmx.net> (maintainer) and all contributors
#
# LICENSE
# This program or module is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
#
# MAINTAINER
# Marko Luther, 2026

import json
import logging
from typing import Any, Final, Protocol, override, TYPE_CHECKING

import aiohttp_jinja2
from aiohttp import web, WSMsgType

from artisanlib.weblcds import WebView

if TYPE_CHECKING:
    from aiohttp.web import Request  # pylint: disable=unused-import


_log: Final[logging.Logger] = logging.getLogger(__name__)


MIRROR_INDEX_PATH: Final[str] = 'mirror'
MIRROR_WS_PATH: Final[str] = 'websocket'
CONTROL_COMMANDS: Final[frozenset[str]] = frozenset({
    'start', 'stop', 'off', 'charge', 'drop', 'dry', 'fcs', 'fce', 'scs', 'sce'
})


class MirrorController(Protocol):
    # Returns the ack payload. The command is only accepted here, not applied yet: the
    # controller queues it to the GUI thread, so an ack must not be read as "applied".
    # Clients see the resulting state in the next snapshot.
    def control(self, cmd: str, token: str) -> dict[str, Any]: ...


class WebMirror(WebView):

    __slots__ = ['_controller']

    def __init__(
        self,
        port: int,
        resource_path: str,
        index_path: str,
        websocket_path: str,
        controller: MirrorController
    ) -> None:
        super().__init__(port, resource_path, index_path, websocket_path)
        self._controller: MirrorController = controller

    @aiohttp_jinja2.template('mirror.tpl')
    @override
    async def index(self, _request: 'Request') -> dict[str, str]:
        return {}

    def publish(self, snapshot: dict[str, Any]) -> None:
        """Publish roast snapshot to all connected clients. Called from GUI thread."""
        try:
            msg = json.dumps(snapshot, indent=None, separators=(',', ':'))
            self.send_msg(msg)
        except Exception as e:  # pylint: disable=broad-except
            _log.exception(e)

    @override
    async def websocket_handler(self, request: 'Request') -> web.WebSocketResponse:
        ws: web.WebSocketResponse = web.WebSocketResponse()
        await ws.prepare(request)
        request.app[self.websockets_appkey].add(ws)
        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    if msg.data == '':
                        # Base behavior: send last message to new client
                        if self._last_message is not None:
                            await self.send_msg_to_ws(ws, self._last_message)
                    else:
                        # Control command handling
                        try:
                            data = json.loads(msg.data)
                            if not isinstance(data, dict):
                                raise json.JSONDecodeError('control message is not a JSON object', msg.data, 0)
                            cmd = data.get('cmd')
                            token = data.get('token')

                            if not isinstance(token, str):
                                response = {'ok': False, 'error': 'bad-message'}
                            elif cmd not in CONTROL_COMMANDS:
                                response = {'ok': False, 'error': 'unknown-command'}
                            else:
                                try:
                                    result = self._controller.control(cmd, token)
                                    response = {'ack': cmd, **result}
                                except Exception as e:  # pylint: disable=broad-except
                                    _log.exception(e)
                                    response = {'ack': cmd, 'ok': False, 'error': 'controller-error'}

                            await ws.send_str(json.dumps(response))
                        except json.JSONDecodeError:
                            try:
                                await ws.send_str(json.dumps({'ok': False, 'error': 'bad-message'}))
                            except Exception as e:  # pylint: disable=broad-except
                                _log.exception(e)
                        except Exception as e:  # pylint: disable=broad-except
                            _log.exception(e)
                elif msg.type == WSMsgType.ERROR:
                    _log.error('ws connection closed with exception %s', ws.exception())
        finally:
            request.app[self.websockets_appkey].discard(ws)
        return ws

    @override
    def startWeb(self) -> bool:
        _log.info('start WebMirror on port %s', self._port)
        return super().startWeb()

    @override
    def stopWeb(self) -> None:
        _log.info('stop WebMirror')
        super().stopWeb()
