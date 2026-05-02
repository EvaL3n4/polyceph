/**
 * js/ui/settings/search-manager.js
 * Optimized search and highlighting for Polyceph preview.
 */

import { logger } from '../../logger.js';

let currentMatches = [];
let currentIndex = -1;
let debounceTimer = null;
let isSearching = false;

/**
 * Initializes search listeners for a container.
 */
export function initSearchListeners(container, switchPageCallback) {
    // Clean up any old listeners if this is a re-init
    $(document).off('input', '#polyceph_preview_search_input');
    $(document).off('change', '#polyceph_preview_search_case, #polyceph_preview_search_regex');
    $(document).off('click', '#polyceph_preview_search_next');
    $(document).off('click', '#polyceph_preview_search_prev');

    $(document).on('input', '#polyceph_preview_search_input', function() {
        const $cont = $(this).closest('.polyceph-preview-modal-content');
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => performSearch($cont, switchPageCallback), 400);
    });

    $(document).on('change', '#polyceph_preview_search_case, #polyceph_preview_search_regex, #polyceph_preview_search_scope', function() {
        const $cont = $(this).closest('.polyceph-preview-modal-content');
        performSearch($cont, switchPageCallback);
    });

    $(document).on('click', '.polyceph-page-btn', function() {
        const $cont = $(this).closest('.polyceph-preview-modal-content');
        const isPageScope = $('#polyceph_preview_search_scope').is(':checked');
        if (isPageScope) {
            performSearch($cont, switchPageCallback);
        }
    });

    $(document).on('click', '#polyceph_preview_search_next', function() {
        const $cont = $(this).closest('.polyceph-preview-modal-content');
        navigate($cont, 1, switchPageCallback);
    });

    $(document).on('click', '#polyceph_preview_search_prev', function() {
        const $cont = $(this).closest('.polyceph-preview-modal-content');
        navigate($cont, -1, switchPageCallback);
    });
}

/**
 * Executes the search across all preview pages.
 */
async function performSearch(container, switchPageCallback) {
    if (isSearching) return;
    isSearching = true;

    const query = $('#polyceph_preview_search_input').val();
    const isCaseSensitive = $('#polyceph_preview_search_case').is(':checked');
    const isRegex = $('#polyceph_preview_search_regex').is(':checked');
    const isPageScope = $('#polyceph_preview_search_scope').is(':checked');
    
    // Reset state
    currentMatches = [];
    currentIndex = -1;
    $('#polyceph_preview_search_count').text('0/0');
    $('#polyceph_preview_search_count').css('opacity', '0.5');

    // Restore ALL pages first to be safe, or just the ones we are about to search
    container.find('.polyceph-preview-div').each(function() {
        const original = $(this).data('original-html');
        if (original) $(this).html(original);
    });

    if (!query || query.length < 1) {
        isSearching = false;
        return;
    }

    try {
        let flags = 'g';
        if (!isCaseSensitive) flags += 'i';
        const searchRegex = isRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

        // Filter pages based on scope
        let pagesToSearch = [];
        if (isPageScope) {
            pagesToSearch = container.find('.polyceph-preview-page.active .polyceph-preview-div').toArray();
        } else {
            pagesToSearch = container.find('.polyceph-preview-div').toArray();
        }
        
        for (const el of pagesToSearch) {
            const $el = $(el);
            if (!$el.data('original-html')) $el.data('original-html', $el.html());
            const originalHtml = $el.data('original-html');
            
            // Chunked processing to prevent UI hang
            const parts = originalHtml.split(/(<[^>]+>)/g);
            let newHtml = "";
            const chunkSize = 100;

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (part.startsWith('<')) {
                    newHtml += part;
                } else {
                    newHtml += part.replace(searchRegex, (match) => {
                        return `<span class="polyceph-preview-search-highlight">${match}</span>`;
                    });
                }
                
                if (i > 0 && i % chunkSize === 0) {
                    // Yield to browser
                    await new Promise(r => requestAnimationFrame(r));
                }
            }
            
            $el.html(newHtml);
        }

        // Collect matches
        currentMatches = container.find('.polyceph-preview-search-highlight').toArray();
        $('#polyceph_preview_search_count').css('opacity', '1');

        if (currentMatches.length > 0) {
            currentIndex = 0;
            updateUI(container, switchPageCallback);
        } else {
            $('#polyceph_preview_search_count').text('0/0');
        }

    } catch (e) {
        logger.error('[Polyceph] Search failed:', e);
    } finally {
        isSearching = false;
    }
}

/**
 * Navigates through matches.
 */
function navigate(container, direction, switchPageCallback) {
    if (currentMatches.length === 0) return;
    
    currentIndex += direction;
    if (currentIndex >= currentMatches.length) currentIndex = 0;
    if (currentIndex < 0) currentIndex = currentMatches.length - 1;
    
    updateUI(container, switchPageCallback);
}

/**
 * Updates the highlight and scrolls into view.
 */
function updateUI(container, switchPageCallback) {
    $(currentMatches).removeClass('active');
    if (currentIndex < 0 || currentIndex >= currentMatches.length) return;

    const $active = $(currentMatches[currentIndex]);
    $active.addClass('active');
    
    $('#polyceph_preview_search_count').text(`${currentIndex + 1}/${currentMatches.length}`);

    // Switch page if necessary
    const $page = $active.closest('.polyceph-preview-page');
    const pageIdx = $page.data('page');
    if (!$page.hasClass('active')) {
        switchPageCallback(container, pageIdx);
    }

    // Scroll into view
    $active[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
}
