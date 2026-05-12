import { MODULE_NAME, defaultSettings } from './constants.js';
import { waitForApiReady, generateId } from './utils.js';
import { capturePresetState, restorePresetState, clearPresetState, getAvailablePresets, getCapturedPresetName } from './compat-presets.js';
export { capturePresetState, restorePresetState, clearPresetState, getAvailablePresets, getCapturedPresetName };
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

export function duplicatePipeline(id) {
    const original = settings.pipelines.find(p => p.id === id);
    if (!original) return null;

    const newId = 'pipeline_' + Math.random().toString(36).substring(2, 9);
    const newPipeline = JSON.parse(JSON.stringify(original));
    newPipeline.id = newId;
    newPipeline.name = `${original.name} (Copy)`;
    newPipeline.isLocked = false;

    settings.pipelines.push(newPipeline);
    settings.activePipelineId = newId;
    saveSettings();
    return newPipeline;
}

export function togglePipelineLock(id) {
    const pipeline = settings.pipelines.find(p => p.id === id);
    if (pipeline) {
        pipeline.isLocked = !pipeline.isLocked;
        saveSettings();
        return pipeline.isLocked;
    }
    return false;
}

export function movePipelineUp(id) {
    const index = settings.pipelines.findIndex(p => p.id === id);
    if (index > 0) {
        const [pipeline] = settings.pipelines.splice(index, 1);
        settings.pipelines.splice(index - 1, 0, pipeline);
        saveSettings();
        return true;
    }
    return false;
}

export function movePipelineDown(id) {
    const index = settings.pipelines.findIndex(p => p.id === id);
    if (index !== -1 && index < settings.pipelines.length - 1) {
        const [pipeline] = settings.pipelines.splice(index, 1);
        settings.pipelines.splice(index + 1, 0, pipeline);
        saveSettings();
        return true;
    }
    return false;
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

export function addImportedPipeline(pipelineData) {
    const newId = generateId();
    const newPipeline = {
        ...pipelineData,
        id: newId,
        isLocked: false
    };
    settings.pipelines.push(newPipeline);
    settings.activePipelineId = newId;
    saveSettings();
    return newPipeline;
}

/**
 * Fetch available connection profiles from ST.
 */
export async function getAvailableProfiles() {
    try {
        const ctx = SillyTavern.getContext();
        let profilesData = null;
        let groupsData = null;

        // Try to get from SillyTavern context first (most reliable for extensions)
        if (ctx.extensionSettings?.connectionManager) {
            const cm = ctx.extensionSettings.connectionManager;
            profilesData = cm.profiles;
            groupsData = cm.groups;
        } else if (ctx.settings?.connection_profiles) {
            profilesData = ctx.settings.connection_profiles;
        }

        if (profilesData || groupsData) {
            logger.debug('Found connection data in SillyTavern context:', { profilesData, groupsData });
            return processProfiles(profilesData, groupsData);
        }

        // Fallback: Fetch from API
        logger.debug('Profiles not in context, fetching from API...');
        const response = await fetch('/api/settings/get', { method: 'POST' });
        const data = await response.json();
        const cm = data?.extension_settings?.connectionManager || data?.connectionManager;
        const locs = [
            { p: cm?.profiles, g: cm?.groups },
            { p: data?.connection_profiles, g: null },
            { p: data?.profiles, g: null },
            { p: data?.api?.profiles, g: null }
        ];

        for (const loc of locs) {
            if (loc.p || loc.g) {
                logger.debug('Found connection data at location:', loc);
                return processProfiles(loc.p, loc.g);
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
function processProfiles(profiles, groups) {
    logger.debug('[State] processProfiles called with:', { profiles, groups });
    let result = [];
    
    // Process Profiles
    if (profiles) {
        if (Array.isArray(profiles)) {
            result = profiles.map(p => {
                if (typeof p === 'string') return { id: p, name: p, api: '', model: '' };
                const api = p.api || p.mode || p.main_api || '';
                const model = p.model || p.openai_model || '';
                return { id: p.id || p.name, name: p.name || p.id, api: api, model: model };
            });
        } else if (typeof profiles === 'object') {
            result = Object.keys(profiles).map(key => {
                const p = profiles[key];
                const api = p.api || p.mode || p.main_api || '';
                const model = p.model || p.openai_model || '';
                return { id: key, name: p.name || key, api: api, model: model };
            });
        }
    }

    // Process Groups
    if (groups) {
        if (Array.isArray(groups)) {
            groups.forEach(g => {
                if (typeof g === 'string') result.push({ id: g, name: g, api: '', model: '' });
                else result.push({ id: g.id || g.name, name: g.name || g.id, api: '', model: '' });
            });
        } else if (typeof groups === 'object') {
            Object.keys(groups).forEach(key => {
                const g = groups[key];
                result.push({ id: key, name: g.name || key, api: '', model: '' });
            });
        }
    }

    availableProfiles = result;
    logger.debug('[State] Extracted profiles (including groups):', availableProfiles);
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
                    // Migration: persist/isCharacter -> outputType
                    if (n.outputType === undefined) {
                        if (n.isCharacter) n.outputType = 'character';
                        else if (n.persist) n.outputType = 'thinking';
                        else n.outputType = 'internal';
                    }

                    if (n.persist === undefined) n.persist = false;
                    if (n.isCharacter === undefined) n.isCharacter = false;
                    if (n.stripThink === undefined) n.stripThink = false;
                    if (n.preset === undefined) n.preset = 'Current';
                    if (n.antiLoop === undefined) n.antiLoop = true;
                    if (n.allowTools === undefined) n.allowTools = true;
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
