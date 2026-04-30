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
 * Polling utility to wait for a specific condition to be met
 * @param {Function} condition Function that returns true/false
 * @param {number} timeout Total timeout in ms
 * @param {number} interval Polling interval in ms
 * @returns {Promise<boolean>} True if condition met, false if timed out
 */
export async function pollCondition(condition, timeout = 5000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (condition()) return true;
        await new Promise(r => setTimeout(r, interval));
    }
    return false;
}

/**
 * Wait for SillyTavern API to be in a connected state
 */
export async function waitForApiReady(timeoutMs = 5000) {
    const start = Date.now();
    let stableChecks = 0;
    const requiredStableChecks = 3;

    while (Date.now() - start < timeoutMs) {
        const context = SillyTavern.getContext();
        const status = context.onlineStatus;
        const isBusy = window.is_send_press === true;

        // Detailed check: No connection or loading means we MUST wait
        const isActuallyLoading = status === 'no_connection' || status.includes('loading');

        if (!isActuallyLoading && !isBusy) {
            stableChecks++;
            if (stableChecks >= requiredStableChecks) {
                return true;
            }
        } else {
            stableChecks = 0;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    return false;
}
