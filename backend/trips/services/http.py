"""Shared HTTP helpers for free map APIs."""

from __future__ import annotations

import logging
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class MapServiceError(Exception):
    """Raised when geocoding or routing fails in a user-visible way."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 502,
        code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def http_get_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float | None = None,
) -> Any:
    timeout = timeout if timeout is not None else getattr(settings, "MAP_HTTP_TIMEOUT", 20)
    default_headers = {
        "User-Agent": getattr(
            settings,
            "MAP_USER_AGENT",
            "SpotterELDTripPlanner/1.0 (assessment; contact@example.com)",
        ),
        "Accept": "application/json",
    }
    if headers:
        default_headers.update(headers)

    try:
        resp = requests.get(url, params=params, headers=default_headers, timeout=timeout)
    except requests.Timeout as exc:
        raise MapServiceError(
            "The map service timed out. Please try again in a moment.",
            status_code=504,
            code="timeout",
        ) from exc
    except requests.RequestException as exc:
        logger.exception("Map HTTP error for %s", url)
        raise MapServiceError(
            "The map service is temporarily unavailable. Please try again.",
            status_code=502,
            code="unavailable",
        ) from exc

    if resp.status_code >= 400:
        logger.warning("Map HTTP %s for %s: %s", resp.status_code, url, resp.text[:400])
        raise _error_from_response(resp)

    try:
        return resp.json()
    except ValueError as exc:
        raise MapServiceError(
            "The map service returned an unreadable response. Please try again.",
            status_code=502,
            code="invalid_json",
        ) from exc


def _error_from_response(resp: requests.Response) -> MapServiceError:
    """Turn provider HTTP errors into clear, user-facing messages."""
    body: Any = None
    try:
        body = resp.json()
    except ValueError:
        body = None

    if isinstance(body, dict):
        provider_code = str(body.get("code") or body.get("error") or "").strip()
        provider_msg = str(
            body.get("message") or body.get("error_message") or body.get("error") or ""
        ).strip()

        # OSRM
        if provider_code == "NoRoute" or "Impossible route" in provider_msg:
            return MapServiceError(
                "No driving route exists between these locations. "
                "They may be on different continents or otherwise unreachable by road. "
                "Please choose places connected by the road network "
                "(for example all within the US or all within Europe).",
                status_code=400,
                code="no_route",
            )
        if provider_code == "NoSegment":
            return MapServiceError(
                "One of the locations could not be matched to a nearby road. "
                "Try a clearer city or street address from the suggestions list.",
                status_code=400,
                code="no_segment",
            )
        if provider_code in {"InvalidQuery", "InvalidOptions", "TooBig"}:
            return MapServiceError(
                "The routing request was invalid. Please check your locations and try again.",
                status_code=400,
                code=provider_code.lower(),
            )

        # Nominatim-style
        if provider_msg and provider_code:
            return MapServiceError(
                f"{provider_msg} ({provider_code})",
                status_code=400 if resp.status_code < 500 else 502,
                code=provider_code.lower()[:64] or "map_error",
            )
        if provider_msg:
            return MapServiceError(
                provider_msg,
                status_code=400 if resp.status_code < 500 else 502,
                code="map_error",
            )

    if resp.status_code == 429:
        return MapServiceError(
            "The map service is rate-limiting requests. Please wait a few seconds and try again.",
            status_code=429,
            code="rate_limited",
        )
    if resp.status_code >= 500:
        return MapServiceError(
            "The map service had a server error. Please try again shortly.",
            status_code=502,
            code="upstream_error",
        )

    return MapServiceError(
        "The map service could not process this request. "
        "Please check your locations and try again.",
        status_code=400,
        code="map_http_error",
    )
