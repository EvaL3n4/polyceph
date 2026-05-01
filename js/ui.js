import { settings } from './state.js';
import { syncHiddenMessageVisibility } from './ui/ui-shared.js';
import { monitorDeletionMode, initChatObserver } from './ui/chat/chat-observer.js';
import { renderPolycephThoughts } from './ui/chat/thoughts-renderer.js';

// Re-export for external modules (like settings-ui.js)
export { syncHiddenMessageVisibility, renderPolycephThoughts };

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
