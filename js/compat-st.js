/**
 * js/compat-st.js
 * Centralized registry for importing SillyTavern core modules.
 * Handles different installation paths (standard vs third-party) and provides
 * a single source of truth for external script dependencies.
 */

import { logger } from './logger.js';

/**
 * Attempts to import a module from various relative and absolute SillyTavern paths.
 * @param {string} fileName - The name of the script to import (e.g., 'openai.js')
 * @returns {Promise<any|null>} The imported module or null if not found.
 */
async function tryImportST(fileName) {
    const basePath = getExtensionPath();
    const segments = basePath.split('/').filter(s => s.length > 0);

    // To reach SillyTavern root from js/ folder:
    // segments.length + 1 levels up.
    // e.g. 'scripts/extensions/polyceph' (3) + 'js' (1) = 4 levels to root
    const levelsToRoot = segments.length + 1;
    const rootDots = '../'.repeat(levelsToRoot);

    // To reach 'scripts/' folder:
    // levelsToRoot - 1
    const scriptsDots = '../'.repeat(levelsToRoot - 1);

    const paths = [
        `${scriptsDots}${fileName}`,
        `${rootDots}scripts/${fileName}`,
        `/scripts/${fileName}` // Absolute fallback
    ];

    const errors = [];
    for (const path of paths) {
        try {
            const module = await import(path);
            if (module) return module;
        } catch (e) {
            errors.push(`${path} -> ${e.message}`);
        }
    }

    logger.debug(`Could not find SillyTavern core script "${fileName}". Attempts:`, errors);
    return null;
}

/**
 * Imports SillyTavern's chat-completion.js as a fallback for ChatCompletion class.
 */
export async function getChatCompletionModule() {
    return await tryImportST('chat-completion.js');
}

/**
 * Imports SillyTavern's messages.js as a fallback for Message class.
 */
export async function getMessagesModule() {
    return await tryImportST('messages.js');
}

/**
 * Imports SillyTavern's world-info.js for settings and engine access.
 */
export async function getWorldInfoModule() {
    return await tryImportST('world-info.js');
}

/**
 * Imports SillyTavern's tool-calling.js which contains the ToolManager.
 */
export async function getToolCallingModule() {
    return await tryImportST('tool-calling.js');
}

/**
 * Imports SillyTavern's openai.js for model listing and metadata.
 */
export async function getOpenAIModule() {
    return await tryImportST('openai.js');
}

/**
 * Imports SillyTavern's textgen-models.js for model name resolution.
 */
export async function getTextGenModelsModule() {
    return await tryImportST('textgen-models.js');
}

/**
 * Imports SillyTavern's textgen-settings.js for API settings access.
 */
export async function getTextGenSettingsModule() {
    return await tryImportST('textgen-settings.js');
}

/**
 * Imports SillyTavern's sse-stream.js for SSE parsing in streaming mode.
 */
export async function getSSEModule() {
    return await tryImportST('sse-stream.js');
}

/**
 * Imports SillyTavern's popup.js for confirmation and input dialogs.
 */
export async function getPopupModule() {
    return await tryImportST('popup.js');
}

/**
 * Imports SillyTavern's main script.js for createRawPrompt and other utilities.
 */
export async function getScriptModule() {
    const basePath = getExtensionPath();
    const segments = basePath.split('/').filter(s => s.length > 0);
    const levelsToRoot = segments.length + 1;
    const rootDots = '../'.repeat(levelsToRoot);

    const paths = [
        `${rootDots}script.js`,
        `/script.js`
    ];

    const errors = [];
    for (const path of paths) {
        try {
            const module = await import(path);
            if (module) return module;
        } catch (e) {
            errors.push(`${path} -> ${e.message}`);
        }
    }

    logger.debug('Could not find SillyTavern script.js. Attempts:', errors);
    return null;
}

/**
 * Detects the extension's base directory relative to the SillyTavern root.
 * This ensures that assets like HTML files can be fetched regardless of whether
 * the extension is installed in the standard or third-party directory.
 * @returns {string} The base path (e.g., 'scripts/extensions/polyceph')
 */
export function getExtensionPath() {
    // import.meta.url for this file is at [base]/js/compat-st.js
    const metaUrl = import.meta.url;

    // Find the 'polyceph' segment and everything before it
    const match = metaUrl.match(/.*scripts\/extensions\/.*polyceph/);
    if (match) {
        const fullPath = match[0];
        // Convert full URL to relative path from origin
        try {
            const url = new URL(fullPath);
            let path = url.pathname;
            // Remove leading slash if it exists (for fetch consistency)
            if (path.startsWith('/')) path = path.substring(1);
            return path;
        } catch (e) {
            // Fallback if URL parsing fails (unlikely in browser)
            return 'scripts/extensions/polyceph';
        }
    }

    // Default fallback
    return 'scripts/extensions/polyceph';
}

