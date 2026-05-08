import { logger } from '../../logger.js';

/**
 * Loads a script from a URL.
 */
function loadScript(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

/**
 * Loads a stylesheet from a URL.
 */
function loadStyle(url) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
}

/**
 * Ensures CodeMirror and required modes are loaded.
 */
export async function ensureCodeMirror() {
    if (typeof CodeMirror !== 'undefined' && CodeMirror.modes.markdown) {
        return;
    }

    logger.info('Loading CodeMirror from CDN...');

    try {
        const version = '5.65.13';
        const baseUrl = `https://cdnjs.cloudflare.com/ajax/libs/codemirror/${version}`;

        loadStyle(`${baseUrl}/codemirror.min.css`);
        loadStyle(`${baseUrl.replace('/js/ui/settings', '')}/styles/components/code-editor.css`);
        await loadScript(`${baseUrl}/codemirror.min.js`);
        await loadScript(`${baseUrl}/mode/xml/xml.min.js`); // Dependency for Markdown
        await loadScript(`${baseUrl}/mode/markdown/markdown.min.js`);
        await loadScript(`${baseUrl}/addon/display/placeholder.min.js`);
        await loadScript(`${baseUrl}/addon/mode/overlay.min.js`);

        logger.info('CodeMirror loaded successfully.');
    } catch (err) {
        logger.error('Failed to load CodeMirror from CDN:', err);
        throw err;
    }
}
