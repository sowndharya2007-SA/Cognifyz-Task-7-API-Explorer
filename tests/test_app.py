"""
Automated Test Suite for API Explorer
Task 7: Cognifyz Full Stack Development Internship

Tests:
- Health endpoint (/api/health)
- Frontend index page (GET /)
- Valid search requests with Open Library mock
- Input validation (missing query, empty query, query too long)
- Pagination validation (negative, zero, non-integer, out of range)
- External API timeouts (504 Gateway Timeout)
- External API connection failures (503 Service Unavailable)
- External API non-200 responses (502 Bad Gateway)
- Malformed JSON responses (502 Bad Gateway)
- Empty search results (200 OK with empty books list)
- In-memory bounded cache behavior (hit avoidance and cache flags)
- Rate limiting behavior (HTTP 429 Too Many Requests)
"""

import json
from unittest.mock import MagicMock, patch
import pytest
import requests

import os
import sys

# Ensure root workspace is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app import create_app, search_cache


@pytest.fixture
def app():
    """Create application configured for testing."""
    test_app = create_app({
        "TESTING": True,
        "RATELIMIT_ENABLED": True,
        "RATELIMIT_STORAGE_URI": "memory://"
    })
    yield test_app
    search_cache.clear()


@pytest.fixture
def client(app):
    """Test client."""
    return app.test_client()


# Sample mock data from Open Library
MOCK_OPEN_LIBRARY_RESPONSE = {
    "numFound": 42,
    "start": 0,
    "docs": [
        {
            "key": "/works/OL45804W",
            "title": "The Lord of the Rings",
            "author_name": ["J.R.R. Tolkien"],
            "first_publish_year": 1954,
            "edition_count": 340,
            "cover_i": 8231856,
            "first_sentence": ["When Mr. Bilbo Baggins of Bag End announced..."]
        },
        {
            "key": "/works/OL15358693W",
            "title": "Clean Code",
            "author_name": ["Robert C. Martin"],
            "first_publish_year": 2008,
            "edition_count": 12,
            "cover_i": None
        }
    ]
}


class TestHealthEndpoint:
    """Tests for GET /api/health."""

    def test_health_check_success(self, client):
        response = client.get("/api/health")
        assert response.status_code == 200
        data = response.get_json()

        assert data["status"] == "healthy"
        assert data["service"] == "API Explorer"
        assert "timestamp" in data
        assert "cache" in data
        assert data["cache"]["type"] == "In-Memory Bounded TTL"
        assert "rate_limits" in data


class TestFrontendIndex:
    """Tests for GET /."""

    def test_index_page_loads(self, client):
        response = client.get("/")
        assert response.status_code == 200
        assert b"API Explorer" in response.data
        assert b"Open Library" in response.data


class TestSearchValidation:
    """Tests for input validation on /api/search."""

    def test_missing_query_parameter(self, client):
        response = client.get("/api/search")
        assert response.status_code == 400
        data = response.get_json()
        assert data["error"] == "Bad Request"
        assert "Search query parameter 'q' is required" in data["message"]

    def test_empty_query_parameter(self, client):
        response = client.get("/api/search?q=")
        assert response.status_code == 400
        data = response.get_json()
        assert data["error"] == "Bad Request"
        assert "cannot be empty" in data["message"]

    def test_whitespace_only_query_parameter(self, client):
        response = client.get("/api/search?q=%20%20%20")
        assert response.status_code == 400
        data = response.get_json()
        assert data["error"] == "Bad Request"
        assert "cannot be empty" in data["message"]

    def test_excessively_long_query(self, client):
        long_query = "a" * 125
        response = client.get(f"/api/search?q={long_query}")
        assert response.status_code == 400
        data = response.get_json()
        assert data["error"] == "Bad Request"
        assert "Search query is too long" in data["message"]

    @pytest.mark.parametrize("invalid_page", ["0", "-1", "abc", "101", "9999"])
    def test_invalid_page_numbers(self, client, invalid_page):
        response = client.get(f"/api/search?q=tolkien&page={invalid_page}")
        assert response.status_code == 400
        data = response.get_json()
        assert data["error"] == "Bad Request"
        assert "Invalid page number" in data["message"]


class TestSearchExternalApiIntegration:
    """Tests with mocked Open Library responses."""

    @patch("requests.get")
    def test_valid_search_success(self, mock_requests_get, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = MOCK_OPEN_LIBRARY_RESPONSE
        mock_requests_get.return_value = mock_response

        response = client.get("/api/search?q=tolkien&page=1")
        assert response.status_code == 200
        assert response.headers["X-Cache"] == "MISS"

        data = response.get_json()
        assert data["status"] == "success"
        assert data["query"] == "tolkien"
        assert data["page"] == 1
        assert data["total_results"] == 42
        assert data["results_count"] == 2
        assert data["cached"] is False

        # Verify books formatting
        books = data["books"]
        assert len(books) == 2
        assert books[0]["title"] == "The Lord of the Rings"
        assert books[0]["authors"] == ["J.R.R. Tolkien"]
        assert books[0]["first_publish_year"] == 1954
        assert books[0]["edition_count"] == 340
        assert books[0]["cover_id"] == 8231856
        assert books[0]["cover_url"] == "https://covers.openlibrary.org/b/id/8231856-M.jpg"
        assert books[0]["open_library_url"] == "https://openlibrary.org/works/OL45804W"

        # Verify second book with None cover
        assert books[1]["title"] == "Clean Code"
        assert books[1]["cover_id"] is None
        assert books[1]["cover_url"] is None

        # Verify external API was called with proper params & timeout
        mock_requests_get.assert_called_once()
        args, kwargs = mock_requests_get.call_args
        assert kwargs["params"]["q"] == "tolkien"
        assert kwargs["params"]["page"] == 1
        assert "timeout" in kwargs

    @patch("requests.get")
    def test_caching_behavior(self, mock_requests_get, client):
        """Verify that identical search within TTL returns cached result without second network call."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = MOCK_OPEN_LIBRARY_RESPONSE
        mock_requests_get.return_value = mock_response

        # 1. First search -> Cache MISS
        res1 = client.get("/api/search?q=cachingtest&page=1")
        assert res1.status_code == 200
        assert res1.headers["X-Cache"] == "MISS"
        data1 = res1.get_json()
        assert data1["cached"] is False
        assert mock_requests_get.call_count == 1

        # 2. Second search -> Cache HIT
        res2 = client.get("/api/search?q=cachingtest&page=1")
        assert res2.status_code == 200
        assert res2.headers["X-Cache"] == "HIT"
        data2 = res2.get_json()
        assert data2["cached"] is True
        # External API should still only have been called ONCE
        assert mock_requests_get.call_count == 1

    @patch("requests.get")
    def test_empty_search_results(self, mock_requests_get, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"numFound": 0, "start": 0, "docs": []}
        mock_requests_get.return_value = mock_response

        response = client.get("/api/search?q=nonexistentbook123xyz")
        assert response.status_code == 200
        data = response.get_json()
        assert data["total_results"] == 0
        assert data["total_pages"] == 0
        assert data["books"] == []


class TestExternalApiErrorHandling:
    """Tests for external API failures, timeouts, and malformed data."""

    @patch("requests.get")
    def test_external_api_timeout(self, mock_requests_get, client):
        mock_requests_get.side_effect = requests.exceptions.Timeout("Read timeout")

        response = client.get("/api/search?q=timeouttest")
        assert response.status_code == 504
        data = response.get_json()
        assert data["error"] == "Gateway Timeout"
        assert "took too long to respond" in data["message"]

    @patch("requests.get")
    def test_external_api_connection_error(self, mock_requests_get, client):
        mock_requests_get.side_effect = requests.exceptions.ConnectionError("Failed to resolve host")

        response = client.get("/api/search?q=conntest")
        assert response.status_code == 503
        data = response.get_json()
        assert data["error"] == "Service Unavailable"
        assert "Unable to connect" in data["message"]

    @patch("requests.get")
    def test_external_api_non_200_status(self, mock_requests_get, client):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_requests_get.return_value = mock_response

        response = client.get("/api/search?q=servererrortest")
        assert response.status_code == 502
        data = response.get_json()
        assert data["error"] == "Bad Gateway"
        assert "responded with status 500" in data["message"]

    @patch("requests.get")
    def test_external_api_malformed_json(self, mock_requests_get, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.side_effect = ValueError("Invalid JSON format")
        mock_requests_get.return_value = mock_response

        response = client.get("/api/search?q=malformedtest")
        assert response.status_code == 502
        data = response.get_json()
        assert data["error"] == "Bad Gateway"
        assert "malformed or non-JSON" in data["message"]


class TestRateLimiting:
    """Tests for backend rate limiting with Flask-Limiter."""

    @patch("requests.get")
    def test_rate_limiting_exceeded_returns_429(self, mock_requests_get, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = MOCK_OPEN_LIBRARY_RESPONSE
        mock_requests_get.return_value = mock_response

        # Route limit is 30/minute.
        # Send 31 requests with unique queries so they don't hit cache
        exceeded = False
        for i in range(35):
            res = client.get(f"/api/search?q=ratelimittest_{i}")
            if res.status_code == 429:
                exceeded = True
                data = res.get_json()
                assert data["error"] == "Too Many Requests"
                assert "Rate limit exceeded" in data["message"]
                assert data["status_code"] == 429
                assert "retry_after" in data
                break

        assert exceeded, "Rate limit should have been triggered after 30 requests"
