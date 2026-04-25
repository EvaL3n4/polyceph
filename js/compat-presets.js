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

// ---------------------------------------------------------------------------
// Preset Enumeration
// ---------------------------------------------------------------------------

/**
 * Gets the PresetManager for the currently active API.
 * Returns null if not available.
 *
 * @returns {object|null} The PresetManager instance, or null.
 */
function getPresetManagerSafe() {
    const ctx = SillyTavern.getContext();
    if (typeof ctx.getPresetManager !== 'function') {
        console.warn(`[${MODULE_NAME}] getPresetManager not available on this ST version.`);
        return null;
    }
    return ctx.getPresetManager();
}

/**
 * Returns an array of all preset names available for the currently active API.
 *
 * @returns {string[]} Array of preset names (display text).
 */
export function getAvailablePresets() {
    const pm = getPresetManagerSafe();
    if (!pm) return [];

    try {
        const presets = pm.getAllPresets();
        return Array.isArray(presets) ? presets : [];
    } catch (e) {
        console.warn(`[${MODULE_NAME}] Error fetching presets:`, e);
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
            console.log(`[${MODULE_NAME}] Preset "${name}" already active.`);
            return true;
        }

        const allPresets = pm.getAllPresets();
        if (!Array.isArray(allPresets) || allPresets.length === 0) {
            console.warn(`[${MODULE_NAME}] No presets available for current API.`);
            return false;
        }

        // Exact match (case-insensitive)
        const exactMatch = allPresets.find(p => p.toLowerCase().trim() === name.toLowerCase().trim());

        if (exactMatch) {
            const presetValue = pm.findPreset(exactMatch);
            if (presetValue != null) {
                pm.selectPreset(presetValue);
                console.log(`[${MODULE_NAME}] Preset switched to "${exactMatch}".`);
                return true;
            }
        }

        console.warn(`[${MODULE_NAME}] Preset "${name}" not found.`);
        return false;
    } catch (e) {
        console.error(`[${MODULE_NAME}] Error applying preset "${name}":`, e);
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
 *
 * @returns {string} The captured preset name.
 */
export function capturePresetState() {
    _capturedPresetName = getCurrentPresetName();
    console.log(`[${MODULE_NAME}] Preset state captured: "${_capturedPresetName}".`);
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
        console.log(`[${MODULE_NAME}] No captured preset state to restore.`);
        return true;
    }

    const current = getCurrentPresetName();
    if (current === _capturedPresetName) {
        console.log(`[${MODULE_NAME}] Preset already at captured state "${_capturedPresetName}".`);
        return true;
    }

    console.log(`[${MODULE_NAME}] Restoring preset from "${current}" to "${_capturedPresetName}".`);
    const result = applyPreset(_capturedPresetName);
    return result;
}

/**
 * Clears the captured preset state. Called at the end of a pipeline run.
 */
export function clearPresetState() {
    _capturedPresetName = null;
}
