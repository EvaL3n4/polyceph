import { settings } from '../state.js';
import { getEl, SELECTORS } from './ui-shared.js';
import { createPipelineSelector, updateChatSelectorOptions } from './chat/pipeline-selector.js';
import { createSendButton, createStopButton, updateSendButtonVisibility } from './chat/action-buttons.js';
import { logger } from '../logger.js';

// Re-export for external use
export { updateSendButtonVisibility, updateChatSelectorOptions };

/**
 * Injects a compact pipeline selector and custom send button into the SillyTavern chat form.
 */
export function injectChatPipelineSelector(sendHandler) {
    const rightForm = getEl(SELECTORS.ST_RIGHT_FORM);
    if (!rightForm) return;

    // Avoid double injection
    if (getEl(SELECTORS.POLY_CONTAINER)) {
        updateChatSelectorOptions();
        updateSendButtonVisibility();
        return;
    }

    const container = createPipelineSelector();
    const polySendBut = createSendButton(sendHandler);
    const polyStopBut = createStopButton();

    const stSendBut = getEl(SELECTORS.ST_SEND_BTN);
    if (stSendBut) {
        rightForm.insertBefore(container, stSendBut);
        rightForm.insertBefore(polySendBut, stSendBut);
        rightForm.insertBefore(polyStopBut, stSendBut);
    } else {
        rightForm.appendChild(container);
        rightForm.appendChild(polySendBut);
        rightForm.appendChild(polyStopBut);
    }

    updateChatSelectorOptions();
    updateSendButtonVisibility();
}
