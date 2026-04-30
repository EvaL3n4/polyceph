/**
 * compat-presets.js
 * Preset management utilities for Polyceph.
 * Wraps SillyTavern's PresetManager API to provide:
 *   - Preset enumeration for the active API
 *   - Preset switching by name
 *   - Snapshot/restore pattern for pipeline execution
 *
 * Reference:
 *   PresetManager class          — preset-manager.js
 *   getPresetManager(apiId)      — preset-manager.js:L83
 *   presetCommandCallback()      — preset-manager.js:L910  (the /preset slash command)
 *   PresetManager.getAllPresets() — preset-manager.js:L376
 *   PresetManager.findPreset()   — preset-manager.js:L385
 *   PresetManager.selectPreset() — preset-manager.js:L411
 *   PresetManager.getSelectedPresetName() — preset-manager.js:L403
 */

import { MODULE_NAME } from './constants.js';
import { logger } from './logger.js';

/**
 * Gets the SillyTavern PresetManager for a specific API.
 * Handles aliases and mapping for derivative APIs (e.g., OpenRouter CC -> OpenAI, OpenRouter TC -> TextGenWebUI).
 * Uses SillyTavern's CONNECT_API_MAP from the context to stay in sync with ST's internal mappings.
 * @param {string} apiId The API ID (e.g., 'openai', 'kobold', 'openrouter')
 * @returns {object|null} The PresetManager instance or null
 */
function getPresetManagerSafe(apiId = '') {
    const ctx = SillyTavern.getContext();
    if (typeof ctx.getPresetManager !== 'function') {
        logger.warn('getPresetManager not available on this ST version.');
        return null;
    }

    // If no apiId provided, ST's getPresetManager will use the current main_api
    if (!apiId) {
        return ctx.getPresetManager('');
    }

    // Use CONNECT_API_MAP from SillyTavern context to find the canonical API
    // This handles mappings like 'openrouter-text' -> 'textgenerationwebui', 'horde' -> 'koboldhorde', etc.
    let canonicalApi = apiId;
    if (ctx.CONNECT_API_MAP && ctx.CONNECT_API_MAP[apiId]) {
        const config = ctx.CONNECT_API_MAP[apiId];
        if (config.selected) {
            canonicalApi = config.selected;
            logger.debug(`Mapped API "${apiId}" to canonical "${canonicalApi}" using CONNECT_API_MAP.`);
        }
    }

    // Return the manager for the resolved canonical API
    const manager = ctx.getPresetManager(canonicalApi);
    if (!manager && canonicalApi !== apiId) {
        // Fallback to original ID if canonical failed for some reason
        return ctx.getPresetManager(apiId);
    }

    return manager;
}

/**
 * Returns an array of all preset names available for the specified or active API.
 *
 * @param {string} apiId - Optional API ID.
 * @returns {string[]} Array of preset names (display text).
 */
export function getAvailablePresets(apiId = '') {
    const pm = getPresetManagerSafe(apiId);
    if (!pm) return [];

    try {
        const presets = pm.getAllPresets();
        return Array.isArray(presets) ? presets : [];
    } catch (e) {
        logger.warn(`Error fetching presets for API "${apiId}":`, e);
        return [];
    }
}

/**
 * Returns the name of the currently selected preset for the active API.
 *
 * @returns {string} Current preset name, or empty string if unavailable.
 */
export function getCurrentPresetName() {
    const pm = getPresetManagerSafe();
    if (!pm) return '';

    try {
        return pm.getSelectedPresetName() || '';
    } catch (e) {
        return '';
    }
}

// ---------------------------------------------------------------------------
// Preset Switching
// ---------------------------------------------------------------------------

/**
 * Switches the active preset by name for the current API.
 * Uses the PresetManager's findPreset + selectPreset pattern,
 * matching the behavior of SillyTavern's /preset slash command.
 *
 * @param {string} name - The display name of the preset to activate.
 * @returns {boolean} True if the preset was found and selected, false otherwise.
 */
export function applyPreset(name) {
    if (!name) return false;

    const pm = getPresetManagerSafe();
    if (!pm) return false;

    try {
        const currentName = pm.getSelectedPresetName();
        if (currentName === name) {
            logger.debug(`Preset "${name}" already active.`);
            return true;
        }

        const allPresets = pm.getAllPresets();
        if (!Array.isArray(allPresets) || allPresets.length === 0) {
            logger.warn('No presets available for current API.');
            return false;
        }

        // Exact match (case-insensitive)
        const exactMatch = allPresets.find(p => p.toLowerCase().trim() === name.toLowerCase().trim());

        if (exactMatch) {
            const presetValue = pm.findPreset(exactMatch);
            if (presetValue != null) {
                pm.selectPreset(presetValue);
                logger.info(`Preset switched to "${exactMatch}".`);
                return true;
            }
        }

        logger.warn(`Preset "${name}" not found.`);
        return false;
    } catch (e) {
        logger.error(`Error applying preset "${name}":`, e);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Snapshot / Restore Pattern
// ---------------------------------------------------------------------------

/** @type {string|null} Captured preset name before pipeline modifications. */
let _capturedPresetName = null;

/**
 * Captures the current preset name so it can be restored later.
 * Called at the start of a pipeline run or before a profile switch.
 * If a preset is already captured, this call is ignored to preserve the original state.
 *
 * @returns {string} The captured preset name.
 */
export function capturePresetState() {
    if (_capturedPresetName === null) {
        _capturedPresetName = getCurrentPresetName();
        logger.debug(`Preset state captured: "${_capturedPresetName}".`);
    } else {
        logger.debug(`Preset state already captured: "${_capturedPresetName}". Skipping.`);
    }
    return _capturedPresetName;
}

/**
 * Returns the previously captured preset name without modifying state.
 *
 * @returns {string|null} The captured preset name, or null if not captured.
 */
export function getCapturedPresetName() {
    return _capturedPresetName;
}

/**
 * Restores the preset to the previously captured state.
 * Only switches if the current preset differs from the captured one.
 *
 * @returns {boolean} True if restoration was performed or unnecessary, false on failure.
 */
export function restorePresetState() {
    if (!_capturedPresetName) {
        logger.debug('No captured preset state to restore.');
        return true;
    }

    const current = getCurrentPresetName();
    if (current === _capturedPresetName) {
        logger.debug(`Preset already at captured state "${_capturedPresetName}".`);
        return true;
    }

    logger.info(`Restoring preset from "${current}" to "${_capturedPresetName}".`);
    const result = applyPreset(_capturedPresetName);
    return result;
}

/**
 * Clears the captured preset state. Called at the end of a pipeline run.
 */
export function clearPresetState() {
    _capturedPresetName = null;
}
