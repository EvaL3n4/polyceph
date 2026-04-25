/**
 * Automatically resize textarea based on content
 */
export function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const newHeight = textarea.scrollHeight > 10 ? (textarea.scrollHeight + 2) : 100;
    textarea.style.height = newHeight + 'px';
}

/**
 * Generate a random alphanumeric string ID
 * Leverages ST's global generateId if available, otherwise fallback.
 */
export function generateId() {
    if (typeof window.generateId === 'function') {
        return window.generateId();
    }
    return Math.random().toString(36).substring(2, 9);
}

/**
 * Wait for SillyTavern API to be in a connected state
 */
export async function waitForApiReady(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const context = SillyTavern.getContext();
        const status = context.onlineStatus;
        if (status !== 'no_connection' && !status.includes('loading')) {
            // Settle a bit after it says it's ready
            await new Promise(r => setTimeout(r, 300));
            return true;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    return false;
}
