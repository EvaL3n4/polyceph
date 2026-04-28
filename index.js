import { MODULE_NAME, VERSION } from './js/constants.js';
import { loadSettings, getAvailableProfiles, refreshPresets, settings } from './js/state.js';
import { renderPolycephThoughts, syncHiddenMessageVisibility } from './js/ui.js';
import { addSettingsUI } from './js/settings-ui.js';
import { startPipeline, runPipeline } from './js/engine.js';
import { injectChatPipelineSelector, updateChatSelectorOptions, updateSendButtonVisibility } from './js/chat-ui.js';
import { postMessageToChat } from './js/compat-shared.js';

// -------------------------------------------------------------------------
// Interception Hook
// -------------------------------------------------------------------------

/**
 * Dedicated handler for the custom Polyceph send button.
 * Avoids interception logic designed for SillyTavern's native buttons.
 */
export async function handlePolycephSend(e) {
    if (settings.activePipelineId === 'none') return;
    console.log(`[${MODULE_NAME}] Polyceph send button clicked.`);
    if (e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    }
    return await processSendAction();
}

/**
 * Interceptor for SillyTavern's native send actions (Enter key, send button).
 */
export async function interceptSend(e) {
    console.log(`[${MODULE_NAME}] [DEBUG-INTERCEPT] interceptSend triggered`, { type: e.type, target: e.target.id || e.target.tagName });
    if (settings.activePipelineId === 'none') {
        console.log(`[${MODULE_NAME}] Polyceph set to 'None', skipping intercept.`);
        return;
    }

    if (e.type === 'keydown' && (e.key !== 'Enter' || e.shiftKey)) {
        return;
    }

    const textarea = document.getElementById('send_textarea');
    if (!textarea) return;

    let text = textarea.value.trim();
    if (text.startsWith('/')) {
        console.debug(`[${MODULE_NAME}] Slash command detected, bypassing Polyceph intercept.`);
        return;
    }

    // Block native behavior immediately to prevent SillyTavern from adding the message
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    return await processSendAction();
}

let lastSendTime = 0;

/**
 * Core logic for processing a send action, whether from native intercept or custom button.
 */
async function processSendAction() {
    const now = Date.now();
    if (now - lastSendTime < 500) {
        console.warn(`[${MODULE_NAME}] Duplicate send action blocked by debouncing (diff: ${now - lastSendTime}ms).`);
        return;
    }
    lastSendTime = now;

    const textarea = document.getElementById('send_textarea');
    const text = textarea ? textarea.value.trim() : '';
    const context = SillyTavern.getContext();

    // EMPTY INPUT: Re-trigger pipeline on last message if it's from the user
    if (!text) {
        const lastMsg = context.chat[context.chat.length - 1];
        if (lastMsg && lastMsg.is_user && !lastMsg.extra?.polyceph_typing) {
            console.log(`[${MODULE_NAME}] Empty input detected. Re-triggering pipeline on last user message.`);

            if (!lastMsg.extra) lastMsg.extra = {};
            lastMsg.extra.polyceph_typing = true;
            lastMsg.extra.polyceph_active_tasks = [];

            if (typeof context.updateMessageBlock === 'function') {
                context.updateMessageBlock(context.chat.length - 1, lastMsg);
            }

            try {
                await startPipeline(lastMsg.mes);
            } catch (err) {
                console.error(`[${MODULE_NAME}] Pipeline re-trigger failed:`, err);
                toastr.error('Pipeline execution failed.', 'Polyceph');
            }
        }
        return;
    }

    // NON-EMPTY INPUT: Create and add a new user message
    if (textarea) textarea.value = '';

    const userName = context.name1 || 'User';
    const avatarStr = typeof context.getThumbnailUrl === 'function' && context.userAvatar ?
        context.getThumbnailUrl('avatar', context.userAvatar) : '';

    console.log(`[${MODULE_NAME}] [DEBUG-ACTION] processSendAction started. Chat length before:`, context.chat.length);

    // Use standardized message posting from compat-shared
    postMessageToChat({
        content: text,
        name: userName,
        isUser: true,
        is_system: false,
        send_date: typeof context.humanizedDateTime === 'function' ? context.humanizedDateTime() : new Date().toLocaleString(),
        mes: text,
        forceAvatar: avatarStr,
        extra: { polyceph_typing: true, polyceph_active_tasks: [] },
        swipes: [text],
        swipe_id: 0,
        swipe_info: [{}]
    });

    console.log(`[${MODULE_NAME}] User message added. Chat length after:`, context.chat.length);
    if (typeof context.saveChat === 'function') context.saveChat();

    // Stagger the pipeline start slightly to allow UI to catch up
    setTimeout(async () => {
        try {
            await startPipeline(text);
        } catch (err) {
            console.error(`[${MODULE_NAME}] Pipeline execution failed:`, err);
            toastr.error('Pipeline execution failed.', 'Polyceph');
        }
    }, 50);
}

function interceptSwipe(e) {
    if (settings.activePipelineId === 'none') return;

    const swipeRightBtn = e.target.closest('.swipe_right');
    if (!swipeRightBtn) return;

    const mesBlock = e.target.closest('.mes');
    if (!mesBlock) return;

    const mesId = parseInt(mesBlock.getAttribute('mesid'));
    const context = SillyTavern.getContext();
    const chatMsg = context.chat[mesId];

    // Check if this message was generated by Polyceph
    if (!chatMsg || !chatMsg.extra || chatMsg.extra.polyceph_source !== 'polyceph') return;

    const swipeId = chatMsg.swipe_id || 0;
    const swipesLen = chatMsg.swipes ? chatMsg.swipes.length : 1;

    // If we are at the last swipe and clicking right, generate a new one
    if (swipeId === swipesLen - 1) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const batchId = chatMsg.extra.polyceph_batch;
        const userInput = chatMsg.extra.polyceph_input || '';

        // Find the user message that preceded this batch to attach the typing indicator to it
        let triggeringUserMesId = -1;
        for (let i = mesId - 1; i >= 0; i--) {
            if (context.chat[i]?.is_user) {
                triggeringUserMesId = i;
                break;
            }
        }

        toastr.info('Polyceph generation running...', 'Polyceph');
        runPipeline(userInput, batchId, triggeringUserMesId);
    }
}

function setupIntercepts() {
    const sendForm = document.getElementById('send_form');
    const rightForm = document.getElementById('rightSendForm');
    const textArea = document.getElementById('send_textarea');

    if (sendForm) {
        // Intercept form submission (e.g. from extensions or scripts calling form.submit())
        sendForm.addEventListener('submit', (e) => {
            if (settings.activePipelineId !== 'none') {
                console.log(`[${MODULE_NAME}] Form submit intercepted.`);
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        }, true);
    }

    if (rightForm) {
        const handleSendEvent = (e) => {
            // Explicitly ignore events from Polyceph's own UI elements
            if (e.target.closest('#polyceph-send-button') || e.target.closest('#polyceph-stop-button') || e.target.closest('#polyceph-chat-pipeline-container')) {
                return;
            }

            const sendBtn = e.target.closest('#send_but');
            if (sendBtn && settings.interceptSend !== false) {
                console.log(`[${MODULE_NAME}] [DEBUG-CAPTURE] Intercepting native send button click.`, { target: e.target.id || e.target.tagName });
                interceptSend(e);
            }
        };

        // Use capture phase to intercept before ST's own listeners
        rightForm.addEventListener('click', handleSendEvent, true);
        rightForm.addEventListener('mousedown', handleSendEvent, true);

        // Monitor for DOM changes (like enabling impersonate button) to re-inject selector
        const observer = new MutationObserver(() => {
            if (!document.getElementById('polyceph-chat-pipeline-container')) {
                console.log(`[${MODULE_NAME}] Chat form changed, re-injecting selector.`);
                injectChatPipelineSelector(handlePolycephSend);
            }
        });
        observer.observe(rightForm, { childList: true, subtree: true });
    }

    if (textArea) textArea.addEventListener('keydown', (e) => {
        if (settings.interceptEnter !== false) {
            interceptSend(e);
        }
    }, true);
    document.body.addEventListener('click', interceptSwipe, true);
}

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------

async function init() {
    console.log(`[${MODULE_NAME}] Initializing Polyceph v${VERSION}...`);

    loadSettings();
    syncHiddenMessageVisibility();
    await getAvailableProfiles();
    refreshPresets();

    addSettingsUI();
    setupIntercepts();
    injectChatPipelineSelector(handlePolycephSend);

    const context = SillyTavern.getContext();
    if (context.eventSource && context.eventTypes) {
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, renderPolycephThoughts);
        context.eventSource.on(context.eventTypes.MESSAGE_RECEIVED, renderPolycephThoughts);
        context.eventSource.on(context.eventTypes.CHAT_COMPLETED, renderPolycephThoughts);

        // Update chat dropdown when settings are saved/changed
        context.eventSource.on(context.eventTypes.SETTINGS_UPDATED, () => {
            updateChatSelectorOptions();
            updateSendButtonVisibility();
        });

        // Listen for our custom settings change event
        context.eventSource.on('polyceph-settings-changed', () => {
            updateSendButtonVisibility();
        });

        // Listen for pipeline activity to swap Send/Stop buttons
        context.eventSource.on('polyceph-pipeline-started', () => {
            updateSendButtonVisibility();
        });
        context.eventSource.on('polyceph-pipeline-ended', () => {
            updateSendButtonVisibility();
        });
    }

    // Initial render for already existing messages
    renderPolycephThoughts();

    console.log(`[${MODULE_NAME}] Polyceph loaded.`);
}

if (typeof jQuery !== 'undefined') {
    jQuery(async () => { await init(); });
} else {
    window.addEventListener('DOMContentLoaded', init);
}
