/**
 * Shared DOM selectors and UI utility functions for the Polyceph extension.
 */

export const SELECTORS = {
    POLY_SEND_BTN: 'polyceph-send-button',
    POLY_STOP_BTN: 'polyceph-stop-button',
    POLY_CONTAINER: 'polyceph-chat-pipeline-container',
    POLY_LABEL: 'polyceph-chat-pipeline-label',
    POLY_DROPDOWN: 'polyceph-chat-pipeline-dropdown',
    ST_SEND_BTN: 'send_but',
    ST_STOP_BTN: 'mes_stop',
    ST_RIGHT_FORM: 'rightSendForm',
    SETTINGS_SELECTOR: 'polyceph_pipeline_selector',
    SETTINGS_CONTAINER: 'polyceph_settings_container',
    STEPS_CONTAINER: 'polyceph_steps_container',
    NAME_INPUT: 'polyceph_active_pipeline_name',
    ST_EDITOR_TEXTAREA: 'curEditTextarea'
};

export const CLASSES = {
    HIDDEN: 'polyceph-hidden',
    DISABLED: 'polyceph-disabled',
    DROPDOWN_ITEM: 'polyceph-dropdown-item',
    ACTIVE: 'active',
    ST_EDITOR_DONE: 'mes_edit_done'
};

/**
 * Gets a DOM element by ID.
 */
export function getEl(id) {
    return document.getElementById(id);
}

/**
 * Shows an element by removing the hidden class and setting display.
 */
export function showEl(el, display = 'flex') {
    if (!el) return;
    el.classList.remove(CLASSES.HIDDEN);
    el.style.display = display;
}

/**
 * Hides an element by adding the hidden class and setting display to none.
 */
export function hideEl(el) {
    if (!el) return;
    el.classList.add(CLASSES.HIDDEN);
    el.style.display = 'none';
}

/**
 * Disables an element (visual only, for ST compatibility).
 */
export function disableEl(el) {
    if (!el) return;
    el.style.opacity = '0.5';
    el.style.pointerEvents = 'none';
    el.classList.add(CLASSES.DISABLED);
}

/**
 * Enables an element.
 */
export function enableEl(el) {
    if (!el) return;
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    el.classList.remove(CLASSES.DISABLED);
}

/**
 * Updates the text content of an element.
 */
export function updateText(el, text) {
    if (!el) return;
    el.innerText = text;
}

/**
 * Binds a toggle click event to an element.
 */
export function bindToggle(btnId, contentId) {
    const btn = getEl(btnId);
    const content = getEl(contentId);
    if (!btn || !content) return;

    btn.addEventListener('click', () => {
        const icon = btn.querySelector('i');
        const isNowActive = content.classList.toggle(CLASSES.ACTIVE);
        if (icon) {
            icon.classList.toggle('fa-chevron-down', !isNowActive);
            icon.classList.toggle('fa-chevron-up', isNowActive);
        }
    });
}

/**
 * Renders a standardized neo-range-slider HTML block.
 */
export function renderNeoSlider(label, id, value, min, max, step) {
    return `
        <div class="alignitemscenter flex-container flexFlowColumn flexGrow flexShrink gap0 flexBasis48p">
            <small>
                <span style="font-weight: bold; margin-bottom: 2px; display: block;">${label}</span>
            </small>
            <input class="neo-range-slider" type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
            <input class="neo-range-input" type="number" id="${id}_value" data-for="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
        </div>
    `;
}

/**
 * Syncs body classes for hidden messages and reasoning based on settings.
 */
export function syncHiddenMessageVisibility(settings) {
    if (!settings) return;
    
    if (settings.showHiddenMessages) {
        document.body.classList.add('polyceph-show-hidden');
    } else {
        document.body.classList.remove('polyceph-show-hidden');
    }

    if (settings.showReasoning !== false) {
        document.body.classList.add('polyceph-show-reasoning');
    } else {
        document.body.classList.remove('polyceph-show-reasoning');
    }
}
/**
 * Scrolls the chat to the bottom.
 * Attempts to use SillyTavern's native scroll helpers if available.
 */
export function scrollToBottom(smooth = true) {
    // 1. Try SillyTavern's native global function
    if (typeof window.scrollChatToBottom === 'function') {
        window.scrollChatToBottom({ waitForFrame: true });
        return;
    }

    // 2. Try SillyTavern's context-aware function
    const context = (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') ? SillyTavern.getContext() : null;
    if (context && typeof context.scrollChatToBottom === 'function') {
        context.scrollChatToBottom({ waitForFrame: true });
        return;
    }

    // 3. Fallback to direct DOM manipulation
    const chat = document.getElementById('chat');
    if (!chat) return;

    if (smooth) {
        $(chat).animate({ scrollTop: chat.scrollHeight }, 200);
    } else {
        chat.scrollTop = chat.scrollHeight;
    }
}

/**
 * Scrolls to the bottom only if the user is already near the bottom.
 * @param {number} threshold - Distance from bottom in pixels to trigger scroll.
 */
export function scrollToBottomIfNear(threshold = 100) {
    const chat = document.getElementById('chat');
    if (!chat) return;

    // Use SillyTavern's native scroll check if possible, or fall back to DOM
    const isNearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < threshold;
    if (isNearBottom) {
        scrollToBottom();
    }
}

/**
 * Checks if the SillyTavern message editor is currently open.
 */
export function isEditorOpen() {
    const textarea = getEl(SELECTORS.ST_EDITOR_TEXTAREA);
    return !!(textarea && (textarea.offsetWidth > 0 || textarea.offsetHeight > 0));
}

/**
 * Triggers a save on the active SillyTavern message edit and waits for completion.
 * @returns {Promise<boolean>} True if saved and closed, false if timed out.
 */
export async function saveActiveEdit() {
    const textarea = getEl(SELECTORS.ST_EDITOR_TEXTAREA);
    if (!textarea) return true; // Already closed

    // Find the save button associated with the current editor
    const mesBlock = textarea.closest('.mes');
    const saveBtn = mesBlock ? mesBlock.querySelector(`.${CLASSES.ST_EDITOR_DONE}`) : document.querySelector(`.${CLASSES.ST_EDITOR_DONE}`);
    
    if (!saveBtn) return false;

    // Using jQuery trigger if available to be as close to ST core behavior as possible
    if (typeof $ !== 'undefined') {
        $(saveBtn).trigger('click');
    } else {
        saveBtn.click();
    }

    // Poll for the editor to close (max 1 second)
    for (let i = 0; i < 20; i++) {
        if (!isEditorOpen()) return true;
        await new Promise(r => setTimeout(r, 50));
    }
    
    return !isEditorOpen();
}
