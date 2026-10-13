/**
 * Mock file contents for the file-slice route (issue #133).
 *
 * The mock fixture carries the real urllib3#5020 diff (hunks only), not
 * full file text, so slices served here are hand-written surroundings for
 * the ranges the expand specs touch, with comment filler elsewhere. Only
 * used through `mockApi.fileSlice` in mock mode; never shipped.
 */
import { MOCK_FILES } from "./diff.js";

export const MOCK_HEAD_SHA = "bdcc1e493e";
export const MOCK_BASE_SHA = "443cb01be1";

/** Cap mirrors the service (`MAX_SLICE_LINES`). */
export const MOCK_SLICE_CAP = 200;

const CONN_HEAD: string[] = [
  "# Mock surroundings for src/urllib3/connection.py (urllib3#5020).",
  "# Only the hunk-boundary lines match the real file; the rest sketches",
  "# the shape (imports, constants, two classes) so expansion reads well.",
  "from __future__ import annotations",
  "",
  "import datetime",
  "import http.client as httplib",
  "import logging",
  "import os",
  "import re",
  "import socket",
  "import typing",
  "import warnings",
  "",
  "from http.client import HTTPException",
  "from socket import timeout as SocketTimeout",
  "",
  "from .exceptions import LocationParseError",
  "from .util import SKIP_HEADER, SKIPPABLE_HEADERS",
  "from .util.connection import _has_ipv6, allowed_gai_family",
  "from .util.request import body_to_chunks",
  "from .util.response import assert_header_lines",
  "from .util.ssl_ import (",
  "    assert_fingerprint,",
  "    create_urllib3_context,",
  "    is_ipaddress,",
  "    resolve_cert_reqs,",
  "    resolve_ssl_version,",
  "    ssl_wrap_socket,",
  ")",
  "from .util.timeout import _DEFAULT_TIMEOUT, _TYPE_TIMEOUT",
  "from .util.url import Url, parse_url",
  "from .util.util import to_str",
  "from .util.wait import wait_for_read, wait_for_write",
  "",
  "if typing.TYPE_CHECKING:",
  '    from .response import HTTPResponse',
  "",
  "log = logging.getLogger(__name__)",
  "",
  "port_by_scheme = {\"http\": 80, \"https\": 443}",
  "",
  "# When domains are rfqdn-quoted, the trailing dot is kept for the SNI",
  "# callback but stripped before the certificate check below.",
  "RECENT_DATE_LIMIT = datetime.timedelta(days=365 * 2)",
  "",
  "class DummyConnection:",
  '    """A plain socket wrapper used by the test double."""',
  "",
  "    def __init__(self, sock: socket.socket) -> None:",
  "        self.sock = sock",
  "        self.is_verified = False",
  "",
  "    def close(self) -> None:",
  "        self.sock.close()",
  "",
  "# Error classes the pool catches while opening a socket.",
  "class NewConnectionError(ConnectTimeoutError):",
  "    pass",
  "",
  "",
  "class NameResolutionError(NewConnectionError):",
  "    pass",
  "",
  "",
  "# The base error the response classes catch; replaced during cleanup.",
  "class CertificateError(ValueError):",
  "    pass",
  "",
  "",
  "# A refused connection surfaces here before the pool retries.",
  "class RefusedConnectionError(NewConnectionError):",
  "    pass",
  "",
  "class BaseSSLError(BaseException):  # type: ignore[no-redef]",
];

const CONN_ADDED: string[] = [
  "# Starting the optional OWS match at the beginning of a whitespace run avoids",
  "# quadratic backtracking for long header values.",
  '_OBSOLETE_FOLD_RE = re.compile(r"(?:(?<![ \\t])[ \\t]+)?\\r\\n[ \\t]+")',
  "",
  "",
  "def _normalize_header_value(value: str) -> str:",
  '    if "\\r\\n" not in value:',
  "        return value",
  '    return _OBSOLETE_FOLD_RE.sub(" ", value)',
  "",
  "",
  "def _normalize_header_values(",
  "    message: http.client.HTTPMessage,",
  ") -> list[tuple[str, str]]:",
  "    header_items = message.items()",
  "    headers_changed = False",
  "    for index, (name, value) in enumerate(header_items):",
  "        normalized_value = _normalize_header_value(value)",
  "        if normalized_value != value:",
  "            header_items[index] = (name, normalized_value)",
  "            headers_changed = True",
  "",
  "    if headers_changed:",
  "        # Keep the original message in sync for downstream consumers such as",
  "        # cookie jars while preserving its identity and header ordering.",
  "        for name, _ in header_items:",
  "            del message[name]",
  "        for name, value in header_items:",
  "            message[name] = value",
  "",
  "    return header_items",
];

const CONN_AFTER_HUNK0: string[] = [
  "",
  "",
  "class HTTPConnection(_HTTPConnection):",
  '    """A persistent per-host connection with idle timeout handling."""',
  "",
  "    default_port: typing.ClassVar[int] = 80",
  "",
  "    def __init__(",
  "        self,",
  '        host: str,',
  "        port: int | None = None,",
  "        timeout: _TYPE_TIMEOUT = _DEFAULT_TIMEOUT,",
  "    ) -> None:",
  "        super().__init__(host, port, timeout=timeout)",
  "        self.sock: socket.socket | None = None",
  "        self.is_verified = False",
  "",
  "    def connect(self) -> None:",
  "        self.sock = socket.create_connection((self.host, self.port))",
  "",
  "    def request(",
  "        self,",
  '        method: str,',
  '        url: str,',
  "    ) -> None:",
  "        # The chunked flag is stored so getresponse can drain correctly.",
  "        self._chunked = body_to_chunks(url) is not None",
  "        super().request(method, url)",
];

const CONN_AROUND_HUNK1: string[] = [
  "        try:",
  "            httplib_response = super().getresponse()",
  "        except SocketTimeout:",
  "            log.info(\"Read timed out waiting for the response headers\")",
  "            raise",
  "        except HTTPException as e:",
  "            log.warning(\"Connection closed without a response: %s\", e,",
  "            exc_info=True,",
  "        )",
  "",
  "        header_items = _normalize_header_values(httplib_response.msg)",
  "        headers = HTTPHeaderDict(header_items)",
  "",
  "        response = HTTPResponse(",
  "            body=httplib_response,",
  "            headers=headers,",
  "            preload_content=False,",
  "            decode_content=False,",
  "        )",
  "        return response",
  "",
  "",
  "class HTTPSConnection(HTTPConnection):",
  "    default_port: typing.ClassVar[int] = 443",
  "",
  "    def __init__(",
  "        self,",
  "        *args: typing.Any,",
  "        **kwargs: typing.Any,",
  "    ) -> None:",
  "        super().__init__(*args, **kwargs)",
  "        self.key_file: str | None = None",
];

const TCONN_HEAD: string[] = [
  "from __future__ import annotations",
  "",
  "import datetime",
  "import socket",
  "import typing",
  "from http.client import HTTPMessage, ResponseNotReady",
  "from unittest import mock",
  "",
  "import pytest",
  "",
  "from urllib3 import HTTPConnection, HTTPSConnection",
  "from urllib3.connection import (",
  "    _match_hostname,",
  "    _normalize_header_value,",
  "    _normalize_header_values,",
  "    _url_from_connection,",
  "    _wrap_proxy_error,",
  ")",
  "from urllib3.exceptions import LocationParseError",
  "",
  "RECENT_DATE = datetime.date(2025, 1, 1)",
  "",
  "",
  "class TestConnection:",
  "    def test_match_hostname(self) -> None:",
  "        assert _match_hostname(\"example.com\", \"example.com\")",
  "        with pytest.raises(LocationParseError):",
  '            _match_hostname("other.com", "example.com")',
  "",
  "    def test_recent_date(self) -> None:",
  "        two_years = datetime.timedelta(days=365 * 2)",
  "        assert RECENT_DATE > (datetime.datetime.today() - two_years).date()",
  "",
  "    def test_HTTPSConnection_default_socket_options(self) -> None:",
  '        conn = HTTPSConnection("not.a.real.host", port=443)',
  "        assert conn.socket_options == [(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)]",
];

function numbered(head: string[], total: number): string[] {
  // 1-based line array: index 0 unused.
  const out: string[] = new Array(total + 1).fill("");
  for (let i = 0; i < head.length && i + 1 <= total; i++) out[i + 1] = head[i];
  return out;
}

function buildConn(): { totalLines: number; at: string[] } {
  const totalLines = 760;
  const at = numbered([], totalLines);
  const put = (start: number, rows: string[]): void => {
    rows.forEach((text, i) => {
      if (start + i <= totalLines) at[start + i] = text;
    });
  };
  put(1, CONN_HEAD);
  // Hunk 0 covers new 77-113: lines 77-79 end the head above (the added
  // helper block follows at 80-110), then the class after the hunk.
  put(80, CONN_ADDED);
  put(111, CONN_AFTER_HUNK0);
  // Hunk 1 covers new 647-654; surroundings sketch getresponse.
  put(640, CONN_AROUND_HUNK1);
  for (let n = 1; n <= totalLines; n++) {
    if (at[n] === "") at[n] = `# filler line ${n}`;
  }
  return { totalLines, at };
}

function buildTconn(): { totalLines: number; at: string[] } {
  const totalLines = 280;
  const at = numbered(TCONN_HEAD, totalLines);
  for (let n = 1; n <= totalLines; n++) {
    if (at[n] === "") at[n] = `# filler line ${n}`;
  }
  return { totalLines, at };
}

/** File path → full mock text (1-based `at`, `totalLines`). */
export const MOCK_FILE_CONTENTS: Record<string, { totalLines: number; at: string[] }> = {
  "src/urllib3/connection.py": buildConn(),
  "test/test_connection.py": buildTconn(),
};

/**
 * Serve a file slice in mock mode. Throws `METHOD path: STATUS {json}`
 * errors shaped like the real client so toasts read the same. Unknown
 * paths 404 (only sketched files expand); binary files 400.
 */
export function mockFileSlice(
  reviewId: string,
  params: { path: string; commit: string; start: number; end: number },
): { path: string; commit: string; start: number; end: number; totalLines: number; lines: string[] } {
  const url = `/api/reviews/${reviewId}/file`;
  const fail = (status: number, error: string): Error => {
    return new Error(`GET ${url}: ${status} ${JSON.stringify({ error })}`);
  };
  if (reviewId !== "demo") throw fail(404, "unknown review");
  const { path: relPath, commit, start, end } = params;
  if (!relPath) throw fail(400, "path is required");
  if (!/^[0-9a-fA-F]{4,64}$/.test(commit)) throw fail(400, "commit must be a hex sha");
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    throw fail(400, "start and end must be line numbers with end after start");
  }
  if (end - start + 1 > MOCK_SLICE_CAP) throw fail(400, `at most ${MOCK_SLICE_CAP} lines per request`);
  const file = MOCK_FILES.find((f) => f.path === relPath);
  if (!file) throw fail(404, `no ${relPath} at ${commit}`);
  if (file.isBinary) throw fail(400, `${relPath} is a binary file and is not shown`);
  const contents = MOCK_FILE_CONTENTS[relPath];
  if (!contents) throw fail(404, `no ${relPath} at ${commit}`);
  if (end > contents.totalLines) throw fail(400, `lines ${start}-${end} are outside ${relPath} (${contents.totalLines} lines)`);
  return {
    path: relPath,
    commit,
    start,
    end,
    totalLines: contents.totalLines,
    lines: contents.at.slice(start, end + 1),
  };
}
