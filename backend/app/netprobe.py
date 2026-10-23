"""One-time network check at startup (NET_PROBE=true): can this host reach the phone line?

Logs whether UDP gets out at all (DNS to 8.8.8.8, STUN), and whether the SIP server answers over UDP and TLS.
The call's audio (RTP) is UDP, so a call only works where UDP to the internet is allowed.
"""
import logging
import os
import secrets
import socket
import ssl
import struct
import uuid

from . import config  # noqa: F401  (loads .env)

log = logging.getLogger("torob-chat.netprobe")


def _udp(host: str, port: int, payload: bytes, timeout: float = 4) -> bytes | None:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.settimeout(timeout)
        try:
            s.sendto(payload, (host, port))
            return s.recvfrom(4096)[0]
        except OSError:
            return None


def _dns_query() -> bytes:
    name = b"".join(bytes([len(p)]) + p for p in b"navaphone.com".split(b".")) + b"\x00"
    return secrets.token_bytes(2) + b"\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00" + name + b"\x00\x01\x00\x01"


def _stun(host: str, port: int) -> str:
    req = struct.pack("!HHI", 0x0001, 0, 0x2112A442) + secrets.token_bytes(12)
    data = _udp(host, port, req)
    if not data or len(data) < 20:
        return "no reply"
    pos = 20
    while pos + 4 <= len(data):  # XOR-MAPPED-ADDRESS: our public address as the server sees it
        kind, size = struct.unpack("!HH", data[pos:pos + 4])
        if kind == 0x0020 and size >= 8:
            port_x, ip_x = struct.unpack("!HI", data[pos + 6:pos + 12])
            ip = socket.inet_ntoa(struct.pack("!I", ip_x ^ 0x2112A442))
            return f"reply, public address {ip}:{port_x ^ 0x2112}"
        pos += 4 + size + (-size % 4)
    return "reply"


def _sip_options(host: str, proto: str, local: str = "0.0.0.0:0") -> bytes:
    tag = uuid.uuid4().hex[:8]
    return (f"OPTIONS sip:{host} SIP/2.0\r\nVia: SIP/2.0/{proto} {local};rport;branch=z9hG4bK{tag}\r\n"
            f"Max-Forwards: 70\r\nFrom: <sip:probe@{host}>;tag={tag}\r\nTo: <sip:{host}>\r\n"
            f"Call-ID: {uuid.uuid4().hex}\r\nCSeq: 1 OPTIONS\r\nContent-Length: 0\r\n\r\n").encode()


def _first_line(data: bytes | None) -> str:
    return data.decode(errors="replace").splitlines()[0] if data else "no reply"


def _sip_tls(host: str, port: int) -> str:
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, port), timeout=6) as raw, ctx.wrap_socket(raw, server_hostname=host) as t:
            t.settimeout(6)
            t.sendall(_sip_options(host, "TLS"))
            return _first_line(t.recv(4096))
    except OSError as e:
        return f"{type(e).__name__}: {e}"


def run() -> None:
    server = os.environ.get("VOIP_SERVER", "")
    results = {
        "UDP DNS 8.8.8.8:53": "reply" if _udp("8.8.8.8", 53, _dns_query()) else "no reply",
        "UDP STUN stun.l.google.com:19302": _stun("stun.l.google.com", 19302),
        "UDP STUN stun.cloudflare.com:3478": _stun("stun.cloudflare.com", 3478),
    }
    if server:
        results[f"UDP SIP {server}:5060"] = _first_line(_udp(server, 5060, _sip_options(server, "UDP")))
        results[f"TLS SIP {server}:5061"] = _sip_tls(server, 5061)
    for check, result in results.items():
        log.info("net check  %-40s %s", check, result)
