import { settings } from '../state.js';
import { syncHiddenMessageVisibility } from './ui-shared.js';
import { monitorDeletionMode, initChatObserver } from './chat/chat-observer.js';
import { renderPolycephThoughts } from './chat/thoughts-renderer.js';

import { updateChatSelectorOptions, updateSendButtonVisibility } from './chat-ui.js';

// Re-export for external modules (like settings-ui.js and index.js)
export { syncHiddenMessageVisibility, renderPolycephThoughts, updateChatSelectorOptions, updateSendButtonVisibility };

/**
 * Initializes the entire Polyceph UI system.
 */
export function initUI() {
    $(document).ready(() => {
        syncHiddenMessageVisibility(settings);
        monitorDeletionMode();
        initChatObserver();
    });
}
