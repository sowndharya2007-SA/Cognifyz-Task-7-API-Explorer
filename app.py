"""
API Explorer - Flask Backend Application
Task 7: Cognifyz Full Stack Development Internship

Demonstrates:
- External API integration with Open Library Search API
- Robust error handling (timeouts, connection failures, malformed JSON, validation)
- Backend rate limiting with Flask-Limiter (HTTP 429 JSON response)
- In-memory bounded cache with TTL
- RESTful health and search endpoints
"""

import math
import time
import logging
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, Optional

import requests
from flask import Flask, jsonify, render_template, request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("api_explorer")

# Constants
OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json"
DEFAULT_CONNECT_TIMEOUT = 5.0
DEFAULT_READ_TIMEOUT = 10.0
MAX_QUERY_LENGTH = 120
DEFAULT_PAGE_SIZE = 12
MAX_PAGE_SIZE = 30
MAX_PAGE_NUMBER = 100
CACHE_MAX_ENTRIES = 100
CACHE_DEFAULT_TTL = 300  # 5 minutes in seconds


class BoundedTTLCache:
    """
    Thread-safe, bounded in-memory cache with Time-To-Live (TTL).
    Resets automatically whenever the Flask server restarts.
    """

    def __init__(self, max_size: int = CACHE_MAX_ENTRIES, default_ttl: int = CACHE_DEFAULT_TTL):
        self.max_size = max_size
        self.default_ttl = default_ttl
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._lock = Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            if key not in self._cache:
                return None
            entry = self._cache[key]
            if time.time() > entry["expires_at"]:
                del self._cache[key]
                return None
            return entry["data"]

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        with self._lock:
            ttl_val = ttl if ttl is not None else self.default_ttl
            now = time.time()

            # Evict expired entries if approaching capacity
            if len(self._cache) >= self.max_size:
                self._prune_expired_unsafe(now)

            # If still at or over capacity, evict the oldest created entry
            if len(self._cache) >= self.max_size:
                oldest_key = min(self._cache, key=lambda k: self._cache[k]["created_at"])
                del self._cache[oldest_key]

            self._cache[key] = {
                "data": value,
                "expires_at": now + ttl_val,
                "created_at": now
            }

    def _prune_expired_unsafe(self, now: float) -> None:
        expired_keys = [k for k, v in self._cache.items() if now > v["expires_at"]]
        for k in expired_keys:
            del self._cache[k]

    def size(self) -> int:
        with self._lock:
            self._prune_expired_unsafe(time.time())
            return len(self._cache)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()


# Initialize global cache
search_cache = BoundedTTLCache(max_size=CACHE_MAX_ENTRIES, default_ttl=CACHE_DEFAULT_TTL)

# Initialize limiter instance
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["120 per minute"],
    storage_uri="memory://"
)


def create_app(test_config=None) -> Flask:
    """Application factory for API Explorer."""
    app = Flask(__name__)

    # Default configuration
    app.config.from_mapping(
        SECRET_KEY="cognifyz-internship-api-explorer-secret-key",
        RATELIMIT_ENABLED=True,
        RATELIMIT_STRATEGY="fixed-window",
        TESTING=False
    )

    if test_config:
        app.config.update(test_config)

    # Initialize rate limiter with app
    limiter.init_app(app)

    # -------------------------------------------------------------
    # Error Handlers
    # -------------------------------------------------------------
    @app.errorhandler(429)
    def ratelimit_exceeded_handler(e):
        """Custom handler for HTTP 429 Too Many Requests."""
        retry_after = getattr(e, "description", "60 seconds")
        return jsonify({
            "status": "error",
            "status_code": 429,
            "error": "Too Many Requests",
            "message": "Rate limit exceeded. You are limited to 30 search requests per minute to prevent API abuse. Please wait before retrying.",
            "retry_after": retry_after
        }), 429

    @app.errorhandler(404)
    def not_found_handler(e):
        if request.path.startswith("/api/"):
            return jsonify({
                "status": "error",
                "status_code": 404,
                "error": "Not Found",
                "message": f"The requested API route '{request.path}' was not found."
            }), 404
        return render_template("index.html"), 404

    @app.errorhandler(405)
    def method_not_allowed_handler(e):
        return jsonify({
            "status": "error",
            "status_code": 405,
            "error": "Method Not Allowed",
            "message": f"Method {request.method} is not permitted for this endpoint."
        }), 405

    @app.errorhandler(500)
    def internal_server_error_handler(e):
        logger.error(f"Internal server error: {e}", exc_info=True)
        return jsonify({
            "status": "error",
            "status_code": 500,
            "error": "Internal Server Error",
            "message": "An unexpected internal server error occurred. Please try again later."
        }), 500

    # -------------------------------------------------------------
    # Web Routes
    # -------------------------------------------------------------
    @app.route("/", methods=["GET"])
    def index():
        """Renders the frontend dashboard."""
        return render_template("index.html")

    # -------------------------------------------------------------
    # API Routes
    # -------------------------------------------------------------
    @app.route("/api/health", methods=["GET"])
    def health_check():
        """
        Health status endpoint.
        Returns system status, cache metrics, and rate limit configuration.
        """
        return jsonify({
            "status": "healthy",
            "service": "API Explorer",
            "version": "1.0.0",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "cache": {
                "active_entries": search_cache.size(),
                "max_entries": search_cache.max_size,
                "ttl_seconds": search_cache.default_ttl,
                "type": "In-Memory Bounded TTL"
            },
            "rate_limits": {
                "search_endpoint": "30 per minute",
                "global_default": "120 per minute"
            },
            "external_api": {
                "name": "Open Library Search API",
                "endpoint": OPEN_LIBRARY_SEARCH_URL
            }
        }), 200

    @app.route("/api/search", methods=["GET"])
    @limiter.limit("30 per minute")
    def search_books():
        """
        Searches books using the Open Library Search API.
        Query Parameters:
            - q: Search string (required, 1-120 chars)
            - page: Page number (optional, integer 1-100, default: 1)
            - limit: Results per page (optional, integer 1-30, default: 12)
        """
        raw_query = request.args.get("q")
        raw_page = request.args.get("page", "1")
        raw_limit = request.args.get("limit", str(DEFAULT_PAGE_SIZE))

        # 1. Validate search query parameter 'q'
        if raw_query is None:
            return jsonify({
                "status": "error",
                "status_code": 400,
                "error": "Bad Request",
                "message": "Search query parameter 'q' is required."
            }), 400

        query = raw_query.strip()
        if not query:
            return jsonify({
                "status": "error",
                "status_code": 400,
                "error": "Bad Request",
                "message": "Search query cannot be empty or contain only whitespace."
            }), 400

        if len(query) > MAX_QUERY_LENGTH:
            return jsonify({
                "status": "error",
                "status_code": 400,
                "error": "Bad Request",
                "message": f"Search query is too long ({len(query)} characters). Maximum permitted length is {MAX_QUERY_LENGTH} characters."
            }), 400

        # 2. Validate 'page' parameter
        try:
            page = int(raw_page)
            if page < 1 or page > MAX_PAGE_NUMBER:
                raise ValueError()
        except (ValueError, TypeError):
            return jsonify({
                "status": "error",
                "status_code": 400,
                "error": "Bad Request",
                "message": f"Invalid page number '{raw_page}'. 'page' must be an integer between 1 and {MAX_PAGE_NUMBER}."
            }), 400

        # 3. Validate 'limit' parameter
        try:
            limit = int(raw_limit)
            if limit < 1 or limit > MAX_PAGE_SIZE:
                limit = DEFAULT_PAGE_SIZE
        except (ValueError, TypeError):
            limit = DEFAULT_PAGE_SIZE

        # 4. Check In-Memory Cache
        cache_key = f"{query.lower()}:{page}:{limit}"
        cached_result = search_cache.get(cache_key)

        if cached_result is not None:
            # Return cached response with cache hit indicators
            response_data = dict(cached_result)
            response_data["cached"] = True
            response = jsonify(response_data)
            response.headers["X-Cache"] = "HIT"
            return response, 200

        # 5. External API Call to Open Library
        params = {
            "q": query,
            "page": page,
            "limit": limit
        }
        headers = {
            "User-Agent": "APIExplorer/1.0 (Cognifyz FullStack Internship Project; Task 7)"
        }

        try:
            external_response = requests.get(
                OPEN_LIBRARY_SEARCH_URL,
                params=params,
                headers=headers,
                timeout=(DEFAULT_CONNECT_TIMEOUT, DEFAULT_READ_TIMEOUT)
            )

        except requests.exceptions.Timeout:
            logger.warning(f"External API timeout for query '{query}', page {page}")
            return jsonify({
                "status": "error",
                "status_code": 504,
                "error": "Gateway Timeout",
                "message": "The Open Library API took too long to respond. Please try again in a few moments."
            }), 504

        except requests.exceptions.ConnectionError:
            logger.warning(f"Connection failure contacting Open Library for query '{query}'")
            return jsonify({
                "status": "error",
                "status_code": 503,
                "error": "Service Unavailable",
                "message": "Unable to connect to the external Open Library service. Please verify internet connectivity or try again later."
            }), 503

        except requests.exceptions.RequestException as exc:
            logger.error(f"External request exception: {exc}")
            return jsonify({
                "status": "error",
                "status_code": 502,
                "error": "Bad Gateway",
                "message": "External book search API request failed. Please try again later."
            }), 502

        # 6. Check External HTTP Status Code
        if external_response.status_code != 200:
            logger.warning(f"Open Library returned non-200 code: {external_response.status_code}")
            return jsonify({
                "status": "error",
                "status_code": 502,
                "error": "Bad Gateway",
                "message": f"External Open Library service responded with status {external_response.status_code}."
            }), 502

        # 7. Parse and Validate External JSON
        try:
            raw_data = external_response.json()
            if not isinstance(raw_data, dict):
                raise ValueError("Payload root is not a dictionary")
        except (ValueError, requests.exceptions.JSONDecodeError):
            logger.error("Failed to decode JSON from Open Library response")
            return jsonify({
                "status": "error",
                "status_code": 502,
                "error": "Bad Gateway",
                "message": "Received malformed or non-JSON data from the external Open Library service."
            }), 502

        # 8. Transform and Normalize Results
        num_found = raw_data.get("numFound", 0)
        docs = raw_data.get("docs", [])
        total_pages = math.ceil(num_found / limit) if num_found > 0 else 0

        books = []
        for doc in docs:
            if not isinstance(doc, dict):
                continue

            cover_id = doc.get("cover_i")
            key = doc.get("key")  # e.g. "/works/OL45804W"

            # Normalize authors list
            authors_raw = doc.get("author_name") or []
            if isinstance(authors_raw, str):
                authors = [authors_raw]
            elif isinstance(authors_raw, list):
                authors = [str(a) for a in authors_raw]
            else:
                authors = []

            # First sentence preview if available
            first_sentence_raw = doc.get("first_sentence")
            first_sentence = None
            if isinstance(first_sentence_raw, list) and len(first_sentence_raw) > 0:
                first_sentence = str(first_sentence_raw[0])
            elif isinstance(first_sentence_raw, str):
                first_sentence = first_sentence_raw

            books.append({
                "title": doc.get("title") or "Untitled",
                "authors": authors,
                "first_publish_year": doc.get("first_publish_year"),
                "edition_count": doc.get("edition_count", 0),
                "cover_id": cover_id,
                "cover_url": f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg" if cover_id else None,
                "cover_url_large": f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg" if cover_id else None,
                "open_library_key": key,
                "open_library_url": f"https://openlibrary.org{key}" if key else None,
                "first_sentence": first_sentence
            })

        payload = {
            "status": "success",
            "query": query,
            "page": page,
            "limit": limit,
            "total_results": num_found,
            "total_pages": total_pages,
            "results_count": len(books),
            "cached": False,
            "books": books
        }

        # 9. Store in In-Memory Bounded Cache
        search_cache.set(cache_key, payload)

        response = jsonify(payload)
        response.headers["X-Cache"] = "MISS"
        return response, 200

    return app


# Default application instance for `flask run` or direct execution
app = create_app()

if __name__ == "__main__":
    print("=" * 60)
    print("API Explorer - Cognifyz Full Stack Internship Task 7")
    print("Server running at: http://127.0.0.1:5000")
    print("=" * 60)
    app.run(host="127.0.0.1", port=5000, debug=True)
