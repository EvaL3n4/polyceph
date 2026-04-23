import { MODULE_NAME, VERSION } from './constants.js';
import { loadSettings, getAvailableProfiles, settings } from './state.js';
import { addSettingsUI } from './ui.js';
import { runPipeline } from './engine.js';

// -------------------------------------------------------------------------
// Interception Hook
// -------------------------------------------------------------------------

function interceptSend(e) {
    if (!settings.enabled) return;

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

    SillyTavern.getContext().executeSlashCommandsWithOptions(`/echo ${text}`, {});
    runPipeline(text);
}

function setupIntercepts() {
    const sendBtn = document.getElementById('send_but');
    const textArea = document.getElementById('send_textarea');

    if (sendBtn) sendBtn.addEventListener('click', interceptSend, true);
    if (textArea) textArea.addEventListener('keydown', interceptSend, true);
}

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------

async function init() {
    console.log(`[${MODULE_NAME}] Initializing Polyceph v${VERSION}...`);

    loadSettings();
    await getAvailableProfiles();

    addSettingsUI();
    setupIntercepts();

    console.log(`[${MODULE_NAME}] Polyceph loaded.`);
}

if (typeof jQuery !== 'undefined') {
    jQuery(async () => { await init(); });
} else {
    window.addEventListener('DOMContentLoaded', init);
}
