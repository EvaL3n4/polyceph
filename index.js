import { MODULE_NAME, VERSION, generationMutexEvents } from './js/constants.js';
import { loadSettings, getAvailableProfiles, refreshPresets, settings } from './js/state.js';
import { initUI, updateChatSelectorOptions, updateSendButtonVisibility } from './js/ui.js';
import { addSettingsUI } from './js/settings-ui.js';
import { startPipeline, runPipeline, clearOrphanedIndicators } from './js/engine.js';
import { injectChatPipelineSelector } from './js/chat-ui.js';
import { postMessageToChat, ensureChatSaved } from './js/compat-shared.js';
import { logger } from './js/logger.js';

// -------------------------------------------------------------------------
// Interception Hook
// -------------------------------------------------------------------------

/**
 * Dedicated handler for the custom Polyceph send button.
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
    if (settings.activePipelineId === 'none') return;
    if (e.type === 'keydown' && (e.key !== 'Enter' || e.shiftKey)) return;

    const textarea = document.getElementById('send_textarea');
    if (!textarea) return;

    let text = textarea.value.trim();
    if (text.startsWith('/')) {
        logger.debug('Slash command detected, bypassing Polyceph intercept.');
        return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    return await processSendAction();
}

let lastSendTime = 0;

/**
 * Core logic for processing a send action.
 */
async function processSendAction() {
    const now = Date.now();
    if (now - lastSendTime < 500) {
        logger.warn(`Duplicate send action blocked by debouncing.`);
        return;
    }
    lastSendTime = now;

    const context = SillyTavern.getContext();

    if (typeof context.deactivateSendButtons === 'function') {
        context.deactivateSendButtons();
    } else if (typeof window.is_send_press !== 'undefined') {
        window.is_send_press = true;
    }

    const textarea = document.getElementById('send_textarea');
    const text = textarea ? textarea.value.trim() : '';

    if (!text) {
        const lastMsg = context.chat[context.chat.length - 1];
        if (lastMsg && lastMsg.is_user && !lastMsg.extra?.polyceph_typing) {
            logger.info('Empty input detected. Re-triggering pipeline.');
            if (!lastMsg.extra) lastMsg.extra = {};
            lastMsg.extra.polyceph_typing = true;
            lastMsg.extra.polyceph_active_tasks = [];

            if (typeof context.updateMessageBlock === 'function') {
                context.updateMessageBlock(context.chat.length - 1, lastMsg);
            }
            try {
                await startPipeline(lastMsg.mes);
            } catch (err) {
                logger.error('Pipeline re-trigger failed:', err);
            }
        }
        return;
    }

    if (textarea) textarea.value = '';

    const userName = context.name1 || 'User';
    const avatarStr = typeof context.getThumbnailUrl === 'function' && context.userAvatar ?
        context.getThumbnailUrl('avatar', context.userAvatar) : '';

    if (settings.emulateCoreEvents && typeof SillyTavern !== 'undefined' && generationMutexEvents) {
        await context.eventSource.emit(generationMutexEvents.MUTEX_CAPTURED, { extension_name: MODULE_NAME });
    }

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

    await ensureChatSaved();

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

    if (!chatMsg || !chatMsg.extra || chatMsg.extra.polyceph_source !== 'polyceph') return;

    const swipeId = chatMsg.swipe_id || 0;
    const swipesLen = chatMsg.swipes ? chatMsg.swipes.length : 1;

    if (swipeId === swipesLen - 1) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const batchId = chatMsg.extra.polyceph_batch;
        const userInput = chatMsg.extra.polyceph_input || '';

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
    const rightForm = document.getElementById('rightSendForm');
    const textArea = document.getElementById('send_textarea');

    if (rightForm) {
        const handleSendEvent = (e) => {
            if (e.target.closest('#polyceph-send-button') || e.target.closest('#polyceph-stop-button') || e.target.closest('#polyceph-chat-pipeline-container')) {
                return;
            }
            const sendBtn = e.target.closest('#send_but');
            if (sendBtn && settings.interceptSend !== false) {
                interceptSend(e);
            }
        };
        rightForm.addEventListener('click', handleSendEvent, true);
        rightForm.addEventListener('mousedown', handleSendEvent, true);

        const observer = new MutationObserver(() => {
            if (!document.getElementById('polyceph-chat-pipeline-container')) {
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

    await loadSettings();
    await clearOrphanedIndicators();
    await getAvailableProfiles();
    refreshPresets();

    // Initialize UI Subsystems
    initUI();
    addSettingsUI();
    setupIntercepts();
    injectChatPipelineSelector(handlePolycephSend);

    const context = SillyTavern.getContext();
    if (context.eventSource && context.eventTypes) {
        // Sync chat buttons on settings/state changes
        context.eventSource.on(context.eventTypes.SETTINGS_UPDATED, () => {
            updateChatSelectorOptions();
            updateSendButtonVisibility();
        });
        context.eventSource.on('polyceph-settings-changed', updateSendButtonVisibility);
        
        context.eventSource.on('polyceph-pipeline-started', () => {
            document.body.classList.add('polyceph-pipeline-active');
            updateSendButtonVisibility();
        });
        context.eventSource.on('polyceph-pipeline-ended', () => {
            document.body.classList.remove('polyceph-pipeline-active');
            updateSendButtonVisibility();
        });
    }

    logger.info('Polyceph loaded.');
}

if (typeof jQuery !== 'undefined') {
    jQuery(async () => { await init(); });
} else {
    window.addEventListener('DOMContentLoaded', init);
}
