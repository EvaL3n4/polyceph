import { MODULE_NAME, defaultSettings } from './constants.js';

export let settings = { ...defaultSettings };
export let availableProfiles = []; // Array of {id, name}

/**
 * Switch ST to a specific profile by ID or Name
 */
export async function switchProfile(profileId) {
    if (!profileId) return false;
    const context = SillyTavern.getContext();

    const prof = availableProfiles.find(p => p.id === profileId);
    const profileName = prof ? prof.name : profileId;

    if (profileName === 'Target' || profileName === 'none') {
        console.log(`[${MODULE_NAME}] switchProfile: skipping for ${profileName}`);
        return true;
    }

    console.log(`[${MODULE_NAME}] switchProfile: switching to "${profileName}" (id: ${profileId})`);
    const quotedName = profileName.includes(' ') ? `"${profileName}"` : profileName;
    try {
        await context.executeSlashCommandsWithOptions(`/profile ${quotedName}`, {
            handleExecutionErrors: false, handleParserErrors: false,
        });
        // Wait a bit for ST events to fire and settings to propagate
        await new Promise(r => setTimeout(r, 500));
        return true;
    } catch (e) {
        console.error(`[${MODULE_NAME}] Error switching profile to ${profileName}:`, e);
        return false;
    }
}

/**
 * Fetch available connection profiles from ST.
 */
export async function getAvailableProfiles() {
    try {
        // Method 1: Check ST DOM directly
        const profileSelect = document.querySelector('#api_profiles, #connection_profiles, select[name="api_profiles"]');
        if (profileSelect) {
            availableProfiles = Array.from(profileSelect.options)
                .map(opt => ({ id: opt.value, name: opt.text }))
                .filter(v => v.id && v.id !== 'default');
            if (availableProfiles.length > 0) return availableProfiles;
        }

        // Method 2: Try settings
        const response = await fetch('/api/settings/get', { method: 'POST' });
        const data = await response.json();
        const possibleLocs = [
            data?.connectionManager?.profiles, data?.connection_profiles,
            data?.profiles, data?.api?.profiles, data?.connectionProfiles
        ];

        for (const loc of possibleLocs) {
            if (loc) {
                if (Array.isArray(loc)) {
                    availableProfiles = loc.map(p => {
                        if (typeof p === 'string') return { id: p, name: p };
                        return { id: p.id || p.name, name: p.name || p.id };
                    });
                } else if (typeof loc === 'object') {
                    availableProfiles = Object.keys(loc).map(key => ({
                        id: key,
                        name: loc[key].name || key
                    }));
                }
                if (availableProfiles.length > 0) return availableProfiles;
            }
        }
    } catch (e) {
        console.error(`[${MODULE_NAME}] Error fetching profiles:`, e);
    }
    return [];
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
        settings = { ...defaultSettings, ...saved };
        // Migration safeguard & property initialization
        settings.steps.forEach(s => {
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
            });
        });
    }
}
