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
    // Relative to js/ directory:
    // Standard: public/scripts/extensions/polyceph/js/ -> 3 levels to scripts/
    // Third-party: public/scripts/extensions/third-party/polyceph/js/ -> 4 levels to scripts/
    const paths = [
        `../../../${fileName}`,
        `../../../../${fileName}`,
        `../../../scripts/${fileName}`,
        `../../../../scripts/${fileName}`,
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
    
    logger.debug(`[Polyceph] Could not find SillyTavern core script "${fileName}". Attempts:`, errors);
    return null;
}

/**
 * Imports SillyTavern's openai.js which contains ChatCompletion and Message classes.
 */
export async function getOpenAIModule() {
    return await tryImportST('openai.js');
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
 * Imports SillyTavern's tool-calling.js which contains the ToolManager.
 */
export async function getToolCallingModule() {
    return await tryImportST('tool-calling.js');
}
