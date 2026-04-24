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
