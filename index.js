import { MODULE_NAME, VERSION, generationMutexEvents } from './js/constants.js';
import { loadSettings, getAvailableProfiles, refreshPresets, settings } from './js/state.js';
import { renderPolycephThoughts, syncHiddenMessageVisibility } from './js/ui.js';
import { addSettingsUI } from './js/settings-ui.js';
import { startPipeline, runPipeline } from './js/engine.js';
import { injectChatPipelineSelector, updateChatSelectorOptions, updateSendButtonVisibility } from './js/chat-ui.js';
import { postMessageToChat } from './js/compat-shared.js';
import { logger } from './js/logger.js';

// -------------------------------------------------------------------------
// Interception Hook
// -------------------------------------------------------------------------

/**
 * Dedicated handler for the custom Polyceph send button.
 * Avoids interception logic designed for SillyTavern's native buttons.
 */
export async function handlePolycephSend(e) {
    if (settings.activePipelineId === 'none') return;
    logger.debug('Polyceph send button clicked.');
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
    if (settings.activePipelineId === 'none') {
        return;
    }

    if (e.type === 'keydown' && (e.key !== 'Enter' || e.shiftKey)) {
        return;
    }

    const textarea = document.getElementById('send_textarea');
    if (!textarea) return;

    let text = textarea.value.trim();
    if (text.startsWith('/')) {
        logger.debug('Slash command detected, bypassing Polyceph intercept.');
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
        logger.warn(`Duplicate send action blocked by debouncing (diff: ${now - lastSendTime}ms).`);
        return;
    }
    lastSendTime = now;

    // Mark ST as busy immediately, matching script.js:Generate()
    if (typeof window.is_send_press !== 'undefined') window.is_send_press = true;

    const textarea = document.getElementById('send_textarea');
    const text = textarea ? textarea.value.trim() : '';
    const context = SillyTavern.getContext();

    // EMPTY INPUT: Re-trigger pipeline on last message if it's from the user
    if (!text) {
        const lastMsg = context.chat[context.chat.length - 1];
        if (lastMsg && lastMsg.is_user && !lastMsg.extra?.polyceph_typing) {
            logger.info('Empty input detected. Re-triggering pipeline on last user message.');

            if (!lastMsg.extra) lastMsg.extra = {};
            lastMsg.extra.polyceph_typing = true;
            lastMsg.extra.polyceph_active_tasks = [];

            if (typeof context.updateMessageBlock === 'function') {
                context.updateMessageBlock(context.chat.length - 1, lastMsg);
            }

            if (context.eventSource && context.eventTypes && settings.emulateCoreEvents) {
                context.eventSource.emit(context.eventTypes.USER_MESSAGE_RENDERED, context.chat.length - 1);
            }

            try {
                await startPipeline(lastMsg.mes);
            } catch (err) {
                logger.error('Pipeline re-trigger failed:', err);
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

    // Capture mutex immediately to block redundant extension triggers
    if (settings.emulateCoreEvents && typeof SillyTavern !== 'undefined' && generationMutexEvents) {
        context.eventSource.emit(generationMutexEvents.MUTEX_CAPTURED, { extension_name: MODULE_NAME });
    }

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

    logger.debug('User message added. Chat length after:', context.chat.length);
    if (typeof context.saveChat === 'function') context.saveChat();

    // Start the pipeline and wait for it to complete or at least establish its lock
    try {
        await startPipeline(text);
    } catch (err) {
        logger.error('Pipeline execution failed:', err);
        toastr.error('Pipeline execution failed.', 'Polyceph');
    }
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
                logger.debug('Form submit intercepted.');
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
                interceptSend(e);
            }
        };

        // Use capture phase to intercept before ST's own listeners
        rightForm.addEventListener('click', handleSendEvent, true);
        rightForm.addEventListener('mousedown', handleSendEvent, true);

        // Monitor for DOM changes (like enabling impersonate button) to re-inject selector
        const observer = new MutationObserver(() => {
            if (!document.getElementById('polyceph-chat-pipeline-container')) {
                logger.debug('Chat form changed, re-injecting selector.');
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
    logger.info(`Initializing Polyceph v${VERSION}...`);

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

    logger.info('Polyceph loaded.');
}

if (typeof jQuery !== 'undefined') {
    jQuery(async () => { await init(); });
} else {
    window.addEventListener('DOMContentLoaded', init);
}
