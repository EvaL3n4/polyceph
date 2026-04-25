import { MODULE_NAME, VERSION } from './js/constants.js';
import { loadSettings, getAvailableProfiles, settings } from './js/state.js';
import { renderPolycephThoughts, syncHiddenMessageVisibility } from './js/ui.js';
import { addSettingsUI } from './js/settings-ui.js';
import { startPipeline } from './js/engine.js';
import { injectChatPipelineSelector, updateChatSelectorOptions } from './js/chat-ui.js';

// -------------------------------------------------------------------------
// Interception Hook
// -------------------------------------------------------------------------

function interceptSend(e) {
    console.log(`[${MODULE_NAME}] interceptSend triggered`, e.type);
    if (settings.activePipelineId === 'none') {
        console.log(`[${MODULE_NAME}] Polyceph set to 'None', skipping intercept.`);
        return;
    }

    const textarea = document.getElementById('send_textarea');
    if (!textarea) return;

    if (e.type === 'keydown' && (e.key !== 'Enter' || e.shiftKey)) {
        return;
    }

    const text = textarea.value.trim();
    if (!text) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    textarea.value = '';

    const context = SillyTavern.getContext();
    const userName = context.name1 || 'User';
    const avatarStr = typeof context.getThumbnailUrl === 'function' && context.userAvatar ?
        context.getThumbnailUrl('avatar', context.userAvatar) : '';

    const message = {
        name: userName,
        is_user: true,
        is_system: false,
        send_date: typeof context.humanizedDateTime === 'function' ? context.humanizedDateTime() : new Date().toLocaleString(),
        mes: text,
        force_avatar: avatarStr,
        extra: {}
    };

    context.chat.push(message);
    if (context.eventSource && context.eventTypes) {
        context.eventSource.emit(context.eventTypes.MESSAGE_RECEIVED, context.chat.length - 1);
    }
    if (typeof context.addOneMessage === 'function') context.addOneMessage(message);
    if (typeof context.saveChat === 'function') context.saveChat();

    startPipeline(text);
}

function interceptSwipe(e) {
    if (settings.activePipelineId === 'none') return;

    if (!e.target.classList.contains('swipe_right')) return;

    const mesBlock = e.target.closest('.mes');
    if (!mesBlock) return;

    const mesId = parseInt(mesBlock.getAttribute('mesid'));
    const context = SillyTavern.getContext();
    const chatMsg = context.chat[mesId];

    if (!chatMsg || !chatMsg.extra || chatMsg.extra.model !== 'polyceph') return;

    const swipeId = chatMsg.swipe_id || 0;
    const swipesLen = chatMsg.swipes ? chatMsg.swipes.length : 1;

    if (swipeId === swipesLen - 1) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        toastr.info('Polyceph generation running...', 'Polyceph');
        const batchId = chatMsg.extra.polyceph_batch;
        const userInput = chatMsg.extra.polyceph_input || '';

        startPipeline(userInput, batchId);
    }
}

function setupIntercepts() {
    const sendBtn = document.getElementById('send_but');
    const textArea = document.getElementById('send_textarea');

    if (sendBtn) sendBtn.addEventListener('click', interceptSend, true);
    if (textArea) textArea.addEventListener('keydown', interceptSend, true);
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

    addSettingsUI();
    setupIntercepts();
    injectChatPipelineSelector();

    const context = SillyTavern.getContext();
    if (context.eventSource && context.eventTypes) {
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, renderPolycephThoughts);
        context.eventSource.on(context.eventTypes.MESSAGE_RECEIVED, renderPolycephThoughts);
        context.eventSource.on(context.eventTypes.CHAT_COMPLETED, renderPolycephThoughts);
        
        // Update chat dropdown when settings are saved/changed
        context.eventSource.on(context.eventTypes.SETTINGS_UPDATED, () => updateChatSelectorOptions());
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
