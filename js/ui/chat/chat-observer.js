import { renderPolycephThoughts } from './thoughts-renderer.js';

/**
 * Monitors SillyTavern's deletion mode dialog to toggle a helper class on the body.
 */
export function monitorDeletionMode() {
    const dialog = document.getElementById('dialogue_del_mes');
    if (!dialog) return;

    const observer = new MutationObserver(() => {
        if (dialog.style.display === 'block') {
            document.body.classList.add('polyceph-delete-mode');
        } else {
            document.body.classList.remove('polyceph-delete-mode');
        }
    });

    observer.observe(dialog, { attributes: true, attributeFilter: ['style'] });

    if (dialog.style.display === 'block') {
        document.body.classList.add('polyceph-delete-mode');
    }
}

/**
 * Initializes the main MutationObserver to watch for chat changes and trigger rendering.
 */
export function initChatObserver() {
    const chat = document.getElementById('chat');
    if (!chat) return;

    const observer = new MutationObserver((mutations) => {
        let shouldRender = false;
        for (const mutation of mutations) {
            const target = mutation.target;

            // Ignore mutations within Polyceph's own UI elements
            if (target.closest && target.closest('.polyceph-typing-indicator, .polyceph-thoughts, .polyceph-background-separator')) {
                continue;
            }

            if (target.nodeType === 1 && (target.classList.contains('mes') || target.closest('.mes'))) {
                shouldRender = true;
                break;
            }
            
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1 && (node.classList.contains('mes') || node.querySelector('.mes'))) {
                    shouldRender = true;
                    break;
                }
            }
            if (shouldRender) break;
        }

        if (shouldRender) {
            // Defer until after ST has completed all updates
            setTimeout(() => renderPolycephThoughts(), 0);
        }
    });

    observer.observe(chat, { childList: true, subtree: true });
    
    // Initial render
    renderPolycephThoughts();
}
