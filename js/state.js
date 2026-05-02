import { MODULE_NAME, defaultSettings } from './constants.js';
import { waitForApiReady } from './utils.js';
import { capturePresetState, restorePresetState, clearPresetState, getAvailablePresets } from './compat-presets.js';
import { setLogLevel, logger } from './logger.js';

export let settings = { ...defaultSettings };
export let availableProfiles = []; // Array of {id, name, api}
export let availablePresetsByApi = {}; // Object of { apiId: string[] }

/**
 * Switch ST to a specific profile by ID or Name
 */
export async function switchProfile(profileId) {
    if (!profileId) return false;
    const context = SillyTavern.getContext();
    const cmSettings = context.extensionSettings?.['connectionManager'];
    const currentProfileId = cmSettings?.selectedProfile;

    logger.debug(`switchProfile debug: target=${profileId}, current=${currentProfileId}`);

    if (currentProfileId && currentProfileId === profileId) {
        logger.debug(`switchProfile: profile ${profileId} already active. Skipping switch.`);
        return true;
    }

    const prof = availableProfiles.find(p => p.id === profileId);
    const profileName = prof ? prof.name : profileId;

    if (profileName === 'Task' || profileName === 'none') {
        logger.debug(`switchProfile: skipping for ${profileName}`);
        return true;
    }

    // Capture preset state before the connection switch resets it
    capturePresetState();

    logger.info(`switchProfile: switching to "${profileName}" (id: ${profileId})`);
    const quotedName = profileName.includes(' ') ? `"${profileName}"` : profileName;
    try {
        await context.executeSlashCommandsWithOptions(`/profile ${quotedName}`, {
            handleExecutionErrors: false, handleParserErrors: false,
        });

        // Wait for API to be ready after profile switch
        await waitForApiReady(2000);

        // Restore preset if the connection switch reset it
        restorePresetState();

        // Wait for preset restoration to settle
        await new Promise(r => setTimeout(r, 500));

        return true;
    } catch (e) {
        logger.error(`Error switching profile to ${profileName}:`, e);
        return false;
    }
}

let _capturedProfileId = null;

/**
 * Captures the current profile ID before pipeline execution.
 */
export function captureProfileState() {
    if (_capturedProfileId === null) {
        const context = SillyTavern.getContext();
        _capturedProfileId = context.extensionSettings?.['connectionManager']?.selectedProfile;
        logger.debug(`Profile state captured: "${_capturedProfileId}".`);
    }
}

/**
 * Restores the profile to the captured state.
 */
export async function restoreProfileState() {
    if (!_capturedProfileId) {
        logger.debug('No captured profile state to restore.');
        return true;
    }

    const context = SillyTavern.getContext();
    const current = context.extensionSettings?.['connectionManager']?.selectedProfile;
    if (current === _capturedProfileId) {
        logger.debug(`Profile already at captured state "${_capturedProfileId}".`);
        return true;
    }

    logger.info(`Restoring profile to "${_capturedProfileId}".`);
    return await switchProfile(_capturedProfileId);
}

/**
 * Clears the captured profile state.
 */
export function clearProfileState() {
    _capturedProfileId = null;
}



/**
 * Pipeline Management
 */
export function getActivePipeline() {
    return settings.pipelines.find(p => p.id === settings.activePipelineId) || settings.pipelines[0];
}

export function createPipeline(name = 'New Pipeline') {
    const id = 'pipeline_' + Math.random().toString(36).substring(2, 9);
    const newPipeline = {
        id,
        name,
        steps: JSON.parse(JSON.stringify(defaultSettings.pipelines[0].steps))
    };
    settings.pipelines.push(newPipeline);
    settings.activePipelineId = id;
    saveSettings();
    return newPipeline;
}

export function deletePipeline(id) {
    if (settings.pipelines.length <= 1) return false;
    const index = settings.pipelines.findIndex(p => p.id === id);
    if (index !== -1) {
        settings.pipelines.splice(index, 1);
        if (settings.activePipelineId === id) {
            settings.activePipelineId = settings.pipelines[0].id;
        }
        saveSettings();
        return true;
    }
    return false;
}

/**
 * Fetch available connection profiles from ST.
 */
export async function getAvailableProfiles() {
    try {
        const ctx = SillyTavern.getContext();
        let profilesData = null;

        // Try to get from SillyTavern context first (most reliable for extensions)
        if (ctx.extensionSettings?.connectionManager?.profiles) {
            profilesData = ctx.extensionSettings.connectionManager.profiles;
        } else if (ctx.settings?.connection_profiles) {
            profilesData = ctx.settings.connection_profiles;
        }

        if (profilesData) {
            logger.debug('Found profiles in SillyTavern context:', profilesData);
            return processProfiles(profilesData);
        }

        // Fallback: Fetch from API
        logger.debug('Profiles not in context, fetching from API...');
        const response = await fetch('/api/settings/get', { method: 'POST' });
        const data = await response.json();
        const possibleLocs = [
            data?.extension_settings?.connectionManager?.profiles,
            data?.connectionManager?.profiles,
            data?.connection_profiles,
            data?.profiles,
            data?.api?.profiles,
            data?.connectionProfiles
        ];

        for (const loc of possibleLocs) {
            if (loc) {
                logger.debug('Found profiles at location:', loc);
                return processProfiles(loc);
            }
        }
    } catch (e) {
        logger.error('Error fetching profiles:', e);
    }
    return [];
}

/**
 * Helper to process profile data into standardized format
 */
function processProfiles(loc) {
    if (Array.isArray(loc)) {
        availableProfiles = loc.map(p => {
            if (typeof p === 'string') return { id: p, name: p, api: '', model: '' };
            const api = p.api || p.mode || p.main_api || '';
            const model = p.model || p.openai_model || '';
            if (!api) logger.warn('Profile object missing API:', p);
            return { id: p.id || p.name, name: p.name || p.id, api: api, model: model };
        });
    } else if (typeof loc === 'object') {
        availableProfiles = Object.keys(loc).map(key => {
            const p = loc[key];
            const api = p.api || p.mode || p.main_api || '';
            const model = p.model || p.openai_model || '';
            if (!api) logger.warn('Profile object missing API:', p);
            return {
                id: key,
                name: p.name || key,
                api: api,
                model: model
            };
        });
    }
    logger.debug('Extracted profiles:', availableProfiles);
    return availableProfiles;
}

/**
 * Refresh the list of available presets for all APIs used by the profiles.
 * @returns {object} Object of { apiId: string[] }
 */
export function refreshPresets() {
    const ctx = SillyTavern.getContext();
    const mainApi = ctx.mainApi;
    const apis = new Set();

    // Always include main API
    if (mainApi) {
        logger.debug(`Adding main API to refresh: ${mainApi}`);
        apis.add(mainApi);
    }

    // Add APIs from profiles
    for (const profile of availableProfiles) {
        if (profile.api && !apis.has(profile.api)) {
            logger.debug(`Adding profile API to refresh: ${profile.api} (from profile: ${profile.name})`);
            apis.add(profile.api);
        }
    }

    const newPresets = {};
    for (const apiId of apis) {
        const presets = getAvailablePresets(apiId);
        newPresets[apiId] = presets;
    }

    availablePresetsByApi = newPresets;
    logger.debug('Refreshed presets for APIs:', Object.keys(availablePresetsByApi));
    return availablePresetsByApi;
}

export function saveSettings() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings) context.extensionSettings = {};
    context.extensionSettings[MODULE_NAME] = settings;
    context.saveSettingsDebounced();
}

export function loadSettings() {
    const context = SillyTavern.getContext();
    const saved = context.extensionSettings?.[MODULE_NAME];
    if (saved) {
        // Migration: top-level steps -> pipelines
        if (saved.steps && !saved.pipelines) {
            saved.pipelines = [{
                id: 'default',
                name: 'Default Pipeline',
                steps: saved.steps
            }];
            saved.activePipelineId = 'default';
            delete saved.steps;
        }

        // Migration: debugMode -> logLevel
        if (saved.debugMode !== undefined && saved.logLevel === undefined) {
            saved.logLevel = saved.debugMode ? 4 : 2;
            delete saved.debugMode;
        }
        delete saved.enabled;

        settings = { ...defaultSettings, ...saved };

        // Ensure activePipelineId is valid
        if (settings.activePipelineId !== 'none' && !settings.pipelines.find(p => p.id === settings.activePipelineId)) {
            settings.activePipelineId = settings.pipelines[0]?.id || 'default';
        }

        // Migration safeguard & property initialization for ALL pipelines
        settings.pipelines.forEach(p => {
            if (!p.steps) p.steps = [];
            p.steps.forEach(s => {
                // Migration: nodes -> tasks
                if (s.nodes && !s.tasks) {
                    s.tasks = s.nodes;
                    delete s.nodes;
                }

                if (!s.tasks) {
                    s.tasks = [{
                        id: 'task_' + Math.random().toString(36).substring(2, 9),
                        profile: s.models?.[0] || '',
                        template: s.template || '{{user_input}}'
                    }];
                }

                // Migration: Move step settings to tasks
                if (s.persist !== undefined || s.cleanPersist !== undefined) {
                    s.tasks.forEach(n => {
                        if (n.persist === undefined) n.persist = !!s.persist;
                        if (n.isCharacter === undefined) n.isCharacter = !!s.cleanPersist;
                    });
                    delete s.persist;
                    delete s.cleanPersist;
                }

                // Ensure all tasks have new properties
                s.tasks.forEach(n => {
                    if (n.persist === undefined) n.persist = false;
                    if (n.isCharacter === undefined) n.isCharacter = false;
                    if (n.stripThink === undefined) n.stripThink = false;
                    if (n.preset === undefined) n.preset = 'Current';
                });
            });
        });

        // Migration: interceptEnter -> enterBehavior
        if (settings.interceptEnter === false) {
            settings.enterBehavior = 'none';
        } else if (settings.interceptEnter === true && settings.enterBehavior === undefined) {
            settings.enterBehavior = 'all';
        }
        delete settings.interceptEnter;

        // Initialize logger state
        setLogLevel(settings.logLevel);
    }
}
