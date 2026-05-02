"""Shared network helpers.

`client_ip(request)` is the single authoritative way to derive the caller's IP.
Rate limiting, anonymous quota buckets, and abuse logging all share it so a
fix in one place propagates everywhere.

Why `trusted_proxy_hops` matters: reverse proxies APPEND the inbound peer to
X-Forwarded-For, so the value at position `-hops` is the first entry our
trusted proxy chain wrote — everything left of that is a spoofable header
the original client (or an intermediate CDN we don't trust) may have set.

Example with hops=1 on Railway:
    attacker sends:  X-Forwarded-For: 1.2.3.4
    edge rewrites:   X-Forwarded-For: 1.2.3.4, <real-browser-ip>
    we take parts[-1] = real-browser-ip → 1.2.3.4 is ignored.
"""

from __future__ import annotations

from app.config import settings


def client_ip(request) -> str:
    hops = max(0, settings.trusted_proxy_hops)
    forwarded = (request.headers.get("x-forwarded-for") or "").strip()
    if hops > 0 and forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if len(parts) >= hops:
            return parts[-hops]
    peer = getattr(request.client, "host", None) if getattr(request, "client", None) else None
    return peer or "unknown"
