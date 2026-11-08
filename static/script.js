/**
 * API Explorer - Frontend Dashboard Controller
 * Task 7: Cognifyz Full Stack Development Internship
 * 
 * Features:
 * - Direct REST integration with Flask /api/search and /api/health
 * - Safe DOM element construction (XSS prevention)
 * - Rate limit handling (HTTP 429 countdown and alerts)
 * - Dynamic pagination with ellipsis handling
 * - In-memory cache status monitoring
 * - Interactive OAuth 2.0 & Telemetry modals
 */

(function () {
    "use strict";

    // Application State
    const state = {
        currentQuery: "",
        currentPage: 1,
        totalPages: 1,
        totalResults: 0,
        pageSize: 12,
        isLoading: false,
        cachedCount: 0
    };

    // DOM Elements
    const elements = {
        // Forms & Inputs
        searchForm: document.getElementById("search-form"),
        searchInput: document.getElementById("search-input"),
        searchSubmitBtn: document.getElementById("search-submit-btn"),
        btnText: document.querySelector(".btn-text"),
        btnSpinner: document.querySelector(".btn-spinner"),
        clearSearchBtn: document.getElementById("clear-search-btn"),
        queryChips: document.querySelectorAll(".query-chip"),

        // Containers & Sections
        resultsSection: document.getElementById("results-section"),
        resultsMetaRibbon: document.getElementById("results-meta-ribbon"),
        metaQueryText: document.getElementById("meta-query-text"),
        metaCountText: document.getElementById("meta-count-text"),
        cacheBadge: document.getElementById("cache-badge"),
        cacheBadgeText: document.getElementById("cache-badge-text"),
        latencyBadge: document.getElementById("latency-badge"),
        latencyText: document.getElementById("latency-text"),
        initialShowcase: document.getElementById("initial-state-showcase"),
        loadingSkeleton: document.getElementById("loading-skeleton-grid"),
        emptyStateCard: document.getElementById("empty-state-card"),
        emptyResetBtn: document.getElementById("empty-reset-btn"),
        booksGrid: document.getElementById("books-grid"),
        inlineErrorBanner: document.getElementById("inline-error-banner"),
        errorTitle: document.getElementById("error-title"),
        errorDesc: document.getElementById("error-desc"),
        errorRetryBtn: document.getElementById("error-retry-btn"),

        // Pagination
        paginationNav: document.getElementById("pagination-nav"),
        prevPageBtn: document.getElementById("prev-page-btn"),
        nextPageBtn: document.getElementById("next-page-btn"),
        paginationPages: document.getElementById("pagination-pages"),
        pageJumpInput: document.getElementById("page-jump-input"),
        pageJumpTotal: document.getElementById("page-jump-total"),
        pageJumpBtn: document.getElementById("page-jump-btn"),

        // Header & Telemetry
        healthBtn: document.getElementById("health-btn"),
        healthDot: document.getElementById("health-dot"),
        healthText: document.getElementById("health-text"),
        toastContainer: document.getElementById("toast-container"),

        // Modals
        oauthModal: document.getElementById("oauth-modal"),
        oauthModalTrigger: document.getElementById("oauth-modal-trigger"),
        oauthModalClose: document.getElementById("oauth-modal-close"),
        oauthModalDismiss: document.getElementById("oauth-modal-dismiss"),

        docsModal: document.getElementById("docs-modal"),
        docsModalTrigger: document.getElementById("docs-modal-trigger"),
        docsModalClose: document.getElementById("docs-modal-close"),
        docsModalDismiss: document.getElementById("docs-modal-dismiss"),
        healthJsonDisplay: document.getElementById("health-json-display"),
        refreshHealthBtn: document.getElementById("refresh-health-btn")
    };

    // -------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------
    function init() {
        registerEventListeners();
        checkBackendHealth();
    }

    // -------------------------------------------------------------
    // Event Listeners
    // -------------------------------------------------------------
    function registerEventListeners() {
        // Search form submit
        elements.searchForm.addEventListener("submit", function (e) {
            e.preventDefault();
            const query = elements.searchInput.value.trim();
            if (!validateQuery(query)) return;
            state.currentQuery = query;
            state.currentPage = 1;
            executeSearch(state.currentQuery, state.currentPage);
        });

        // Search input typing (toggle clear button)
        elements.searchInput.addEventListener("input", function () {
            if (this.value.length > 0) {
                elements.clearSearchBtn.classList.remove("hidden");
            } else {
                elements.clearSearchBtn.classList.add("hidden");
            }
        });

        // Clear search input button
        elements.clearSearchBtn.addEventListener("click", function () {
            elements.searchInput.value = "";
            elements.clearSearchBtn.classList.add("hidden");
            elements.searchInput.focus();
        });

        // Quick query chips
        elements.queryChips.forEach(chip => {
            chip.addEventListener("click", function () {
                const query = this.dataset.query;
                elements.searchInput.value = query;
                elements.clearSearchBtn.classList.remove("hidden");
                state.currentQuery = query;
                state.currentPage = 1;
                executeSearch(query, 1);
            });
        });

        // Pagination buttons
        elements.prevPageBtn.addEventListener("click", function () {
            if (state.currentPage > 1 && !state.isLoading) {
                state.currentPage--;
                executeSearch(state.currentQuery, state.currentPage);
            }
        });

        elements.nextPageBtn.addEventListener("click", function () {
            if (state.currentPage < state.totalPages && !state.isLoading) {
                state.currentPage++;
                executeSearch(state.currentQuery, state.currentPage);
            }
        });

        elements.pageJumpBtn.addEventListener("click", function () {
            handlePageJump();
        });

        elements.pageJumpInput.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                handlePageJump();
            }
        });

        // Retry and Reset buttons
        elements.errorRetryBtn.addEventListener("click", function () {
            if (state.currentQuery) {
                executeSearch(state.currentQuery, state.currentPage);
            }
        });

        elements.emptyResetBtn.addEventListener("click", function () {
            elements.searchInput.value = "";
            elements.clearSearchBtn.classList.add("hidden");
            elements.searchInput.focus();
            showInitialState();
        });

        // Health diagnostics trigger
        elements.healthBtn.addEventListener("click", function () {
            openDocsModal();
            fetchDiagnostics();
        });

        // Modal triggers
        elements.oauthModalTrigger.addEventListener("click", openOAuthModal);
        elements.oauthModalClose.addEventListener("click", closeOAuthModal);
        elements.oauthModalDismiss.addEventListener("click", closeOAuthModal);
        elements.oauthModal.addEventListener("click", function (e) {
            if (e.target === elements.oauthModal) closeOAuthModal();
        });

        elements.docsModalTrigger.addEventListener("click", function () {
            openDocsModal();
            fetchDiagnostics();
        });
        elements.docsModalClose.addEventListener("click", closeDocsModal);
        elements.docsModalDismiss.addEventListener("click", closeDocsModal);
        elements.docsModal.addEventListener("click", function (e) {
            if (e.target === elements.docsModal) closeDocsModal();
        });

        elements.refreshHealthBtn.addEventListener("click", fetchDiagnostics);

        // Global keyboard shortcuts
        document.addEventListener("keydown", function (e) {
            // Close modals on Escape
            if (e.key === "Escape") {
                closeOAuthModal();
                closeDocsModal();
            }
            // Press "/" to focus search bar (if not typing in an input)
            if (e.key === "/" && document.activeElement !== elements.searchInput && document.activeElement !== elements.pageJumpInput) {
                e.preventDefault();
                elements.searchInput.focus();
                elements.searchInput.select();
            }
        });
    }

    // -------------------------------------------------------------
    // Query Validation
    // -------------------------------------------------------------
    function validateQuery(query) {
        if (!query || query.trim().length === 0) {
            showToast("Search query cannot be empty. Please enter a title, author, or keyword.", "warning", "Validation Error");
            elements.searchInput.focus();
            return false;
        }
        if (query.length > 120) {
            showToast("Search query is too long (maximum 120 characters).", "warning", "Input Too Long");
            return false;
        }
        return true;
    }

    // -------------------------------------------------------------
    // Core Search Execution (Calling Flask Backend)
    // -------------------------------------------------------------
    async function executeSearch(query, page) {
        if (state.isLoading) return;

        setLoading(true);
        hideErrorBanner();
        elements.initialShowcase.classList.add("hidden");
        elements.emptyStateCard.classList.add("hidden");

        const startTime = performance.now();
        const endpoint = `/api/search?q=${encodeURIComponent(query)}&page=${encodeURIComponent(page)}&limit=${state.pageSize}`;

        try {
            const response = await fetch(endpoint, {
                method: "GET",
                headers: {
                    "Accept": "application/json"
                }
            });

            const latencyMs = Math.round(performance.now() - startTime);
            const data = await response.json();

            if (!response.ok) {
                handleHttpError(response.status, data);
                return;
            }

            // Success
            state.totalPages = Math.max(1, data.total_pages || 1);
            state.totalResults = data.total_results || 0;

            renderSearchResults(data, latencyMs);

        } catch (err) {
            console.error("Network or fetch error:", err);
            showInlineError("Network Connection Error", "Unable to communicate with the local server. Ensure the Flask backend is running on http://127.0.0.1:5000.");
            showToast("Network failure. Check your server connection.", "error", "Connection Error");
        } finally {
            setLoading(false);
        }
    }

    // -------------------------------------------------------------
    // HTTP Error Handling (Rate Limit 429, 504 Timeout, etc.)
    // -------------------------------------------------------------
    function handleHttpError(statusCode, errorData) {
        const title = errorData.error || `HTTP ${statusCode}`;
        const message = errorData.message || "An unexpected error occurred while searching.";

        if (statusCode === 429) {
            // Rate Limit Exceeded
            showToast(message, "warning", "Rate Limit Exceeded (429)");
            showInlineError("Rate Limit Throttling Active", `${message} Please wait before initiating new searches.`);
        } else if (statusCode === 504) {
            // Gateway Timeout
            showToast("The upstream Open Library API timed out.", "error", "Gateway Timeout (504)");
            showInlineError("External API Timeout", message);
        } else if (statusCode === 503) {
            // Service Unavailable
            showToast("Open Library service is currently unreachable.", "error", "Service Unavailable (503)");
            showInlineError("Service Unavailable", message);
        } else if (statusCode === 400) {
            // Bad Request
            showToast(message, "warning", "Bad Request (400)");
            showInlineError("Validation Failed", message);
        } else {
            // 500 or 502 Bad Gateway
            showToast(message, "error", `Server Error (${statusCode})`);
            showInlineError(`Error (${statusCode})`, message);
        }

        elements.booksGrid.innerHTML = "";
        elements.resultsMetaRibbon.classList.add("hidden");
        elements.paginationNav.classList.add("hidden");
    }

    // -------------------------------------------------------------
    // Render Results & Safe DOM Construction
    // -------------------------------------------------------------
    function renderSearchResults(data, latencyMs) {
        const books = data.books || [];

        // Update Meta Ribbon
        elements.resultsMetaRibbon.classList.remove("hidden");
        elements.metaQueryText.textContent = `"${data.query}"`;
        elements.metaCountText.textContent = `${data.total_results.toLocaleString()} books found`;

        // Cache Badge
        if (data.cached) {
            elements.cacheBadge.className = "meta-badge cache-badge";
            elements.cacheBadgeText.textContent = "⚡ Cache HIT (0ms)";
            elements.cacheBadge.setAttribute("title", "Response retrieved instantly from in-memory cache without hitting Open Library");
        } else {
            elements.cacheBadge.className = "meta-badge cache-badge miss";
            elements.cacheBadgeText.textContent = "🌐 Live API Fetch";
            elements.cacheBadge.setAttribute("title", "Live response requested from Open Library Search API and cached in memory");
        }

        // Latency Badge
        elements.latencyText.textContent = `${latencyMs} ms`;

        // Handle Empty State
        if (books.length === 0) {
            elements.booksGrid.innerHTML = "";
            elements.emptyStateCard.classList.remove("hidden");
            elements.paginationNav.classList.add("hidden");
            return;
        }

        elements.emptyStateCard.classList.add("hidden");
        elements.booksGrid.innerHTML = "";

        // Build Book Cards safely via DocumentFragment
        const fragment = document.createDocumentFragment();

        books.forEach((book, index) => {
            const card = document.createElement("article");
            card.className = "book-card";
            card.setAttribute("tabindex", "0");
            card.setAttribute("aria-label", `Book: ${book.title}`);

            // 1. Cover container
            const coverContainer = document.createElement("div");
            coverContainer.className = "book-cover-container";

            if (book.cover_url) {
                const img = document.createElement("img");
                img.className = "book-cover-img";
                img.src = book.cover_url;
                img.alt = `Cover of ${book.title}`;
                img.loading = "lazy";

                // Error fallback if image fails to load
                img.onerror = function () {
                    this.remove();
                    coverContainer.appendChild(createFallbackCover(book.title, book.authors));
                };

                coverContainer.appendChild(img);
            } else {
                coverContainer.appendChild(createFallbackCover(book.title, book.authors));
            }

            card.appendChild(coverContainer);

            // 2. Card Body
            const body = document.createElement("div");
            body.className = "book-body";

            // Title
            const titleElem = document.createElement("h4");
            titleElem.className = "book-title";
            titleElem.textContent = book.title || "Untitled";
            titleElem.setAttribute("title", book.title || "Untitled");
            body.appendChild(titleElem);

            // Authors
            const authorsElem = document.createElement("p");
            authorsElem.className = "book-authors";
            const authorsText = (book.authors && book.authors.length > 0)
                ? book.authors.join(", ")
                : "Unknown Author";
            authorsElem.textContent = authorsText;
            authorsElem.setAttribute("title", authorsText);
            body.appendChild(authorsElem);

            // Meta Pills (Year & Editions)
            const pillsContainer = document.createElement("div");
            pillsContainer.className = "book-meta-pills";

            if (book.first_publish_year) {
                const yearPill = document.createElement("span");
                yearPill.className = "meta-pill";
                yearPill.textContent = `📅 ${book.first_publish_year}`;
                pillsContainer.appendChild(yearPill);
            }

            if (book.edition_count > 0) {
                const editionsPill = document.createElement("span");
                editionsPill.className = "meta-pill";
                editionsPill.textContent = `📚 ${book.edition_count} ${book.edition_count === 1 ? 'edition' : 'editions'}`;
                pillsContainer.appendChild(editionsPill);
            }

            if (book.open_library_key) {
                const keyPill = document.createElement("span");
                keyPill.className = "meta-pill";
                // Shorten "/works/OL12345W" -> "OL12345W"
                keyPill.textContent = `ID: ${book.open_library_key.replace('/works/', '')}`;
                pillsContainer.appendChild(keyPill);
            }

            body.appendChild(pillsContainer);

            // 3. Card Footer (Link to Open Library)
            const footer = document.createElement("div");
            footer.className = "book-footer";

            if (book.open_library_url) {
                const link = document.createElement("a");
                link.className = "ol-link";
                link.href = book.open_library_url;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.setAttribute("aria-label", `Open ${book.title} on Open Library`);

                link.innerHTML = `
                    <span>View Record</span>
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                `;
                footer.appendChild(link);
            } else {
                const span = document.createElement("span");
                span.className = "text-muted";
                span.style.fontSize = "0.75rem";
                span.textContent = "No external link";
                footer.appendChild(span);
            }

            body.appendChild(footer);
            card.appendChild(body);
            fragment.appendChild(card);
        });

        elements.booksGrid.appendChild(fragment);

        // Update Pagination Controls
        renderPagination();

        // Smooth scroll to results top if changing pages
        if (state.currentPage > 1) {
            elements.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }

    // Fallback Cover Creation
    function createFallbackCover(title, authors) {
        const fallback = document.createElement("div");
        fallback.className = "book-cover-fallback";

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "1.5");
        svg.setAttribute("class", "fallback-icon");

        const path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path1.setAttribute("d", "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z");
        const path2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path2.setAttribute("d", "M6 6h10");
        const path3 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path3.setAttribute("d", "M6 10h7");

        svg.appendChild(path1);
        svg.appendChild(path2);
        svg.appendChild(path3);
        fallback.appendChild(svg);

        const titleSpan = document.createElement("span");
        titleSpan.className = "fallback-title";
        titleSpan.textContent = title || "Book Cover Unavailable";
        fallback.appendChild(titleSpan);

        return fallback;
    }

    // -------------------------------------------------------------
    // Pagination Controls
    // -------------------------------------------------------------
    function renderPagination() {
        if (state.totalPages <= 1) {
            elements.paginationNav.classList.add("hidden");
            return;
        }

        elements.paginationNav.classList.remove("hidden");
        elements.prevPageBtn.disabled = (state.currentPage <= 1);
        elements.nextPageBtn.disabled = (state.currentPage >= state.totalPages);

        elements.pageJumpInput.value = state.currentPage;
        elements.pageJumpInput.max = state.totalPages;
        elements.pageJumpTotal.textContent = `of ${state.totalPages}`;

        elements.paginationPages.innerHTML = "";

        // Calculate visible page buttons (current, surrounding pages, 1st and last)
        const pages = [];
        const current = state.currentPage;
        const total = state.totalPages;

        if (total <= 7) {
            for (let i = 1; i <= total; i++) pages.push(i);
        } else {
            pages.push(1);
            if (current > 3) pages.push("...");

            const start = Math.max(2, current - 1);
            const end = Math.min(total - 1, current + 1);

            for (let i = start; i <= end; i++) {
                pages.push(i);
            }

            if (current < total - 2) pages.push("...");
            pages.push(total);
        }

        pages.forEach(p => {
            if (p === "...") {
                const ellipsis = document.createElement("span");
                ellipsis.className = "page-ellipsis";
                ellipsis.textContent = "…";
                elements.paginationPages.appendChild(ellipsis);
            } else {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = `page-num-btn ${p === current ? 'active' : ''}`;
                btn.textContent = p;
                btn.setAttribute("aria-label", `Page ${p}`);
                if (p === current) btn.setAttribute("aria-current", "page");

                btn.addEventListener("click", () => {
                    if (p !== state.currentPage && !state.isLoading) {
                        state.currentPage = p;
                        executeSearch(state.currentQuery, state.currentPage);
                    }
                });

                elements.paginationPages.appendChild(btn);
            }
        });
    }

    function handlePageJump() {
        const val = parseInt(elements.pageJumpInput.value, 10);
        if (isNaN(val) || val < 1 || val > state.totalPages) {
            showToast(`Please enter a valid page number between 1 and ${state.totalPages}.`, "warning", "Invalid Page");
            elements.pageJumpInput.value = state.currentPage;
            return;
        }
        if (val !== state.currentPage && !state.isLoading) {
            state.currentPage = val;
            executeSearch(state.currentQuery, state.currentPage);
        }
    }

    // -------------------------------------------------------------
    // Loading State & UI Helpers
    // -------------------------------------------------------------
    function setLoading(isLoading) {
        state.isLoading = isLoading;
        if (isLoading) {
            elements.searchSubmitBtn.disabled = true;
            elements.btnText.textContent = "Searching...";
            elements.btnSpinner.classList.remove("hidden");
            elements.loadingSkeleton.classList.remove("hidden");
            elements.booksGrid.innerHTML = "";
        } else {
            elements.searchSubmitBtn.disabled = false;
            elements.btnText.textContent = "Search Catalog";
            elements.btnSpinner.classList.add("hidden");
            elements.loadingSkeleton.classList.add("hidden");
        }
    }

    function showInlineError(title, description) {
        elements.errorTitle.textContent = title;
        elements.errorDesc.textContent = description;
        elements.inlineErrorBanner.classList.remove("hidden");
    }

    function hideErrorBanner() {
        elements.inlineErrorBanner.classList.add("hidden");
    }

    function showInitialState() {
        elements.initialShowcase.classList.remove("hidden");
        elements.emptyStateCard.classList.add("hidden");
        elements.resultsMetaRibbon.classList.add("hidden");
        elements.booksGrid.innerHTML = "";
        elements.paginationNav.classList.add("hidden");
        hideErrorBanner();
    }

    // -------------------------------------------------------------
    // Toast Notification System
    // -------------------------------------------------------------
    function showToast(message, type = "info", title = "") {
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.setAttribute("role", "alert");

        // Icon based on type
        let iconSvg = "";
        if (type === "error" || type === "warning") {
            iconSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${type === 'error' ? '#ef4444' : '#f59e0b'}" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
        } else if (type === "success") {
            iconSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#10b981" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
        } else {
            iconSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#6366f1" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
        }

        toast.innerHTML = `
            <div class="toast-icon">${iconSvg}</div>
            <div class="toast-body">
                ${title ? `<div class="toast-title">${title}</div>` : ""}
                <div class="toast-message">${message}</div>
            </div>
            <button type="button" class="toast-close" aria-label="Close notification">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `;

        const closeBtn = toast.querySelector(".toast-close");
        closeBtn.addEventListener("click", () => {
            toast.style.opacity = "0";
            toast.style.transform = "translateX(100%)";
            setTimeout(() => toast.remove(), 200);
        });

        elements.toastContainer.appendChild(toast);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.opacity = "0";
                toast.style.transform = "translateX(100%)";
                setTimeout(() => toast.remove(), 200);
            }
        }, 5000);
    }

    // -------------------------------------------------------------
    // Health Check & Telemetry
    // -------------------------------------------------------------
    async function checkBackendHealth() {
        try {
            const res = await fetch("/api/health");
            if (res.ok) {
                const data = await res.json();
                elements.healthDot.className = "status-dot healthy";
                elements.healthText.textContent = "API Online";
                state.cachedCount = data.cache?.active_entries || 0;
            } else {
                elements.healthDot.className = "status-dot degraded";
                elements.healthText.textContent = `HTTP ${res.status}`;
            }
        } catch {
            elements.healthDot.className = "status-dot offline";
            elements.healthText.textContent = "API Offline";
        }
    }

    async function fetchDiagnostics() {
        elements.healthJsonDisplay.textContent = "Querying /api/health...";
        try {
            const res = await fetch("/api/health");
            const data = await res.json();
            elements.healthJsonDisplay.textContent = JSON.stringify(data, null, 2);
        } catch (err) {
            elements.healthJsonDisplay.textContent = `Error fetching telemetry: ${err.message}`;
        }
    }

    // -------------------------------------------------------------
    // Modals
    // -------------------------------------------------------------
    function openOAuthModal() {
        elements.oauthModal.classList.remove("hidden");
        document.body.style.overflow = "hidden";
    }

    function closeOAuthModal() {
        elements.oauthModal.classList.add("hidden");
        document.body.style.overflow = "";
    }

    function openDocsModal() {
        elements.docsModal.classList.remove("hidden");
        document.body.style.overflow = "hidden";
    }

    function closeDocsModal() {
        elements.docsModal.classList.add("hidden");
        document.body.style.overflow = "";
    }

    // Start application on DOM ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
