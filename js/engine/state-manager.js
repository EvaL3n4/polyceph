import { logger } from '../logger.js';
import { settings, captureProfileState, restoreProfileState, clearProfileState } from '../state.js';
import { capturePresetState, restorePresetState, clearPresetState } from '../compat-presets.js';

/**
 * Captures the current SillyTavern session state (API Profile and Preset).
 */
export function captureSessionState() {
    logger.debug('Capturing session state (Profile & Preset)');
    captureProfileState();
    capturePresetState();
}

/**
 * Restores the SillyTavern session state to what it was before the pipeline run.
 * Handles the asynchronous wait for profile reloads.
 */
export async function restoreSessionState() {
    if (!settings.restore_after_run) {
        logger.info('Restoration disabled, staying on current preset.');
        clearProfileState();
        clearPresetState();
        return;
    }

    logger.info('Restoring original profile and preset state...');
    const stContext = SillyTavern.getContext();
    
    // Create a listener for the restoration completion (connection_profile_loaded)
    // This is necessary because SillyTavern reloads the chat and UI when profile changes.
    const restorationPromise = new Promise(resolve => {
        const handler = () => {
            logger.debug('Detected connection_profile_loaded event.');
            resolve();
        };
        stContext.eventSource.once('connection_profile_loaded', handler);
        // Fallback timeout in case event doesn't fire
        setTimeout(resolve, 3000);
    });

    try {
        await restoreProfileState();
        await restorationPromise;
        restorePresetState();
    } catch (err) {
        logger.error('Failed to restore session state:', err);
    } finally {
        clearProfileState();
        clearPresetState();
    }
}
