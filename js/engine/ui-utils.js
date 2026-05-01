import { logger } from '../logger.js';
import { ensureChatSaved } from '../compat-shared.js';

/**
 * Brute-force ensures the SillyTavern stop button is hidden and UI state is reset.
 * Overwrites residual inline styles from third-party extensions.
 */
export function forceHideStopButton() {
    const context = SillyTavern.getContext();
    const stopBtn = document.getElementById('mes_stop');
    if (stopBtn) stopBtn.style.display = 'none';

    if (typeof context.activateSendButtons === 'function') {
        context.activateSendButtons();
    } else if (typeof window.is_send_press !== 'undefined') {
        window.is_send_press = false;
    }
}

/**
 * Updates the typing indicator meta-text in the DOM for the active message.
 */
export function updateTypingIndicator() {
    const context = SillyTavern.getContext();
    const typingIdx = context.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
    if (typingIdx !== -1 && typeof context.updateMessageBlock === 'function') {
        context.updateMessageBlock(typingIdx, context.chat[typingIdx]);
    }
}

/**
 * Activates the polyceph typing indicator flag on a specific message.
 */
export function startTypingIndicator(mesId, taskLabels = []) {
    const context = SillyTavern.getContext();
    const msg = context.chat[mesId];
    if (msg) {
        if (!msg.extra) msg.extra = {};
        msg.extra.polyceph_typing = true;
        msg.extra.polyceph_active_tasks = taskLabels;
        updateTypingIndicator();
    }
}

/**
 * Exhaustively removes all typing indicator flags from the chat and updates the UI.
 */
export async function removeTypingIndicator() {
    const context = SillyTavern.getContext();
    if (!context.chat) return;

    let modified = false;
    context.chat.forEach((msg, idx) => {
        if (msg && msg.extra && (msg.extra.polyceph_typing || msg.extra.polyceph_active_tasks || msg.extra.polyceph_stopping)) {
            delete msg.extra.polyceph_typing;
            delete msg.extra.polyceph_active_tasks;
            delete msg.extra.polyceph_stopping;
            modified = true;
            if (typeof context.updateMessageBlock === 'function') {
                context.updateMessageBlock(idx, msg);
            }
        }
    });

    if (modified) {
        logger.debug('Typing indicator(s) and metadata flags removed.');
        await ensureChatSaved();
    }
}

/**
 * Startup cleanup to remove any orphaned indicators from interrupted runs.
 */
export async function clearOrphanedIndicators() {
    logger.debug('Starting startup cleanup for orphaned indicators...');
    await removeTypingIndicator();
}
