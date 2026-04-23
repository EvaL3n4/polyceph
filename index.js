const MODULE_NAME = 'polyceph';
const VERSION = '0.2.0';

const defaultSettings = {
    enabled: false,
    persistThoughts: false,
    steps: [
        {
            id: 'step_1',
            persist: false,
            nodes: [
                { id: 'node_1', profile: '', template: '{{user_input}}' }
            ]
        }
    ]
};

let settings = { ...defaultSettings };
let availableProfiles = []; // Array of {id, name}

/**
 * Fetch available connection profiles from ST.
 */
async function getAvailableProfiles() {
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

/**
 * Switch ST to a specific profile by ID or Name
 */
async function switchProfile(profileId) {
    if (!profileId) return false;
    const context = SillyTavern.getContext();
    
    // Find the readable name since `/profile` usually expects the UI name
    const prof = availableProfiles.find(p => p.id === profileId);
    const profileName = prof ? prof.name : profileId;
    
    const quotedName = profileName.includes(' ') ? `"${profileName}"` : profileName;
    try {
        await context.executeSlashCommandsWithOptions(`/profile ${quotedName}`, {
            handleExecutionErrors: false, handleParserErrors: false,
        });
        return true;
    } catch (e) {
        console.error(`[${MODULE_NAME}] Error switching profile to ${profileName}:`, e);
        return false;
    }
}

function saveSettings() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings) context.extensionSettings = {};
    context.extensionSettings[MODULE_NAME] = settings;
    context.saveSettingsDebounced();
}

function loadSettings() {
    const context = SillyTavern.getContext();
    const saved = context.extensionSettings?.[MODULE_NAME];
    if (saved) {
        settings = { ...defaultSettings, ...saved };
        // Migration safeguard
        settings.steps.forEach(s => {
            if (!s.nodes) {
                s.nodes = [{ id: 'node_' + generateId(), profile: s.models?.[0] || '', template: s.template || '{{user_input}}' }];
            }
        });
    }
}

/**
 * Automatically resize textarea based on content
 */
function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const newHeight = textarea.scrollHeight > 0 ? (textarea.scrollHeight + 2) : 40;
    textarea.style.height = newHeight + 'px';
}

// -------------------------------------------------------------------------
// UI Generation
// -------------------------------------------------------------------------

function renderNode(stepId, node) {
    const profileOptions = availableProfiles.map(p => `<option value="${p.id}" ${p.id === node.profile ? 'selected' : ''}>${p.name}</option>`).join('');
    
    return `
        <div class="polyceph-node-card" data-node-id="${node.id}">
            <div class="polyceph-node-header">
                <select class="polyceph-node-profile-select" data-step="${stepId}" data-node="${node.id}">
                    <option value="">-- Select Target Profile --</option>
                    ${profileOptions}
                </select>
                <button class="menu_button polyceph-remove-node-btn" data-step="${stepId}" data-node="${node.id}" title="Remove Target">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <textarea class="polyceph-node-template" data-step="${stepId}" data-node="${node.id}" placeholder="Use {{user_input}}...">${node.template}</textarea>
        </div>
    `;
}

function renderStep(step, index) {
    const nodesHtml = step.nodes.map(n => renderNode(step.id, n)).join('');

    return `
        <div class="polyceph-step-card" data-step-id="${step.id}">
            <div class="polyceph-step-header">
                <span>Step ${index + 1}</span>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <label style="font-size: 0.85em; display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" class="polyceph-persist-step" data-step="${step.id}" ${step.persist ? 'checked' : ''}>
                        Persist output
                    </label>
                    <button class="menu_button polyceph-remove-step-btn" data-step="${step.id}" title="Remove Step">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="polyceph-nodes-list">
                ${nodesHtml}
            </div>
            <button class="menu_button polyceph-add-node-btn" data-step="${step.id}">
                <i class="fa-solid fa-plus"></i> Add Profile Target
            </button>
        </div>
    `;
}

function updateUI() {
    const stepsContainer = document.getElementById('polyceph_steps_container');
    if (stepsContainer) {
        stepsContainer.innerHTML = settings.steps.map((s, i) => renderStep(s, i)).join('');
        
        // Auto-resize all textareas after render - with a small delay for layout settlement
        setTimeout(() => {
            stepsContainer.querySelectorAll('textarea').forEach(textarea => {
                autoResizeTextarea(textarea);
            });
        }, 50);
        
        bindStepEvents();
    }
}

function bindStepEvents() {
    const container = document.getElementById('polyceph_settings_container');
    if (!container) return;

    // Node profile select
    container.querySelectorAll('.polyceph-node-profile-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const stepId = e.target.getAttribute('data-step');
            const nodeId = e.target.getAttribute('data-node');
            const step = settings.steps.find(s => s.id === stepId);
            const node = step?.nodes.find(n => n.id === nodeId);
            if (node) {
                node.profile = e.target.value;
                saveSettings();
            }
        });
    });

    // Node template textarea
    container.querySelectorAll('.polyceph-node-template').forEach(textarea => {
        textarea.addEventListener('input', (e) => {
            autoResizeTextarea(e.target);
            const stepId = e.target.getAttribute('data-step');
            const nodeId = e.target.getAttribute('data-node');
            const step = settings.steps.find(s => s.id === stepId);
            const node = step?.nodes.find(n => n.id === nodeId);
            if (node) {
                node.template = e.target.value;
                saveSettings();
            }
        });
    });

    // Remove Node
    container.querySelectorAll('.polyceph-remove-node-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const stepId = e.currentTarget.getAttribute('data-step');
            const nodeId = e.currentTarget.getAttribute('data-node');
            const step = settings.steps.find(s => s.id === stepId);
            if (step) {
                step.nodes = step.nodes.filter(n => n.id !== nodeId);
                saveSettings();
                updateUI();
            }
        });
    });

    // Add Node
    container.querySelectorAll('.polyceph-add-node-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const stepId = e.currentTarget.getAttribute('data-step');
            const step = settings.steps.find(s => s.id === stepId);
            if (step) {
                step.nodes.push({ id: 'node_' + generateId(), profile: '', template: '{{user_input}}' });
                saveSettings();
                updateUI();
            }
        });
    });

    // Persist Toggle
    container.querySelectorAll('.polyceph-persist-step').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const step = settings.steps.find(s => s.id === e.target.getAttribute('data-step'));
            if (step) { step.persist = e.target.checked; saveSettings(); }
        });
    });

    // Remove Step
    container.querySelectorAll('.polyceph-remove-step-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            settings.steps = settings.steps.filter(s => s.id !== e.currentTarget.getAttribute('data-step'));
            saveSettings();
            updateUI();
        });
    });
}

function createSettingsHTML() {
    return `
        <div class="polyceph-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Polyceph</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="polyceph-header">
                        Configure complex multi-model reasoning pipelines.
                    </div>
                    
                    <div class="polyceph-placeholders-container">
                        <div class="polyceph-placeholders-header" id="polyceph_placeholders_toggle">
                            <b>Available Placeholders</b>
                            <i class="fa-solid fa-chevron-down"></i>
                        </div>
                        <div class="polyceph-placeholders-content" id="polyceph_placeholders_content">
                            <ul style="margin: 0; padding-left: 20px;">
                                <li><code>{{user_input}}</code> - The original user text.</li>
                                <li><code>{{step_1}}</code>, <code>{{step_2}}</code>... - Combined output of a step.</li>
                                <li><code>{{step_1_target_1}}</code>, <code>{{step_1_target_2}}</code>... - Output of an individual target node within a step.</li>
                            </ul>
                        </div>
                    </div>
                    
                    <button id="polyceph_refresh_profiles" class="menu_button" style="margin-bottom: 15px;">
                        <i class="fa-solid fa-refresh"></i> Refresh Profiles
                    </button>
                    
                    <div style="margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" id="polyceph_enabled" ${settings.enabled ? 'checked' : ''}>
                        <label for="polyceph_enabled"><b>Enable Polyceph Pipeline Interception</b></label>
                    </div>

                    <div id="polyceph_steps_container" class="polyceph-step-list"></div>

                    <button id="polyceph_add_step_btn" class="menu_button">
                        <i class="fa-solid fa-plus"></i> Add Pipeline Step
                    </button>
                </div>
            </div>
        </div>
    `;
}

function addSettingsUI() {
    const container = document.getElementById('extensions_settings');
    if (!container) return;

    const existing = document.getElementById('polyceph_settings_container');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.id = 'polyceph_settings_container';
    wrapper.innerHTML = createSettingsHTML();
    container.appendChild(wrapper);

    updateUI();

    // Toggle placeholders visibility
    document.getElementById('polyceph_placeholders_toggle').addEventListener('click', () => {
        const content = document.getElementById('polyceph_placeholders_content');
        const icon = document.querySelector('#polyceph_placeholders_toggle i');
        const isActive = content.classList.toggle('active');
        icon.classList.toggle('fa-chevron-down', !isActive);
        icon.classList.toggle('fa-chevron-up', isActive);
    });

    document.getElementById('polyceph_enabled').addEventListener('change', (e) => {
        settings.enabled = e.target.checked;
        saveSettings();
        toastr.info(settings.enabled ? 'Polyceph pipeline enabled.' : 'Polyceph pipeline disabled.');
    });

    document.getElementById('polyceph_add_step_btn').addEventListener('click', () => {
        settings.steps.push({
            id: 'step_' + generateId(),
            persist: false,
            nodes: [{ id: 'node_' + generateId(), profile: '', template: '{{user_input}}' }]
        });
        saveSettings();
        updateUI();
    });

    document.getElementById('polyceph_refresh_profiles').addEventListener('click', async () => {
        await getAvailableProfiles();
        updateUI();
        toastr.success(`Profiles refreshed. Found ${availableProfiles.length}.`, 'Polyceph');
    });
}


// -------------------------------------------------------------------------
// Pipeline Engine execution
// -------------------------------------------------------------------------

async function generateQuietly(profileName, prompt) {
    if (!profileName) return "(No Profile Target Selected)";

    try {
        const responseData = await new Promise((resolve, reject) => {
            if (typeof jQuery !== 'undefined') {
                jQuery.ajax({
                    url: '/api/generate',
                    type: 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify({ text: prompt }),
                    success: resolve,
                    error: (xhr, status, error) => reject(error)
                });
            } else {
                fetch('/api/generate', {
                    method: 'POST',
                    body: JSON.stringify({ text: prompt }),
                    headers: { 'Content-Type': 'application/json' }
                }).then(res => res.json()).then(resolve).catch(reject);
            }
        });
        
        if (responseData && responseData.text) return responseData.text;
        if (responseData && responseData.choices && responseData.choices[0] && responseData.choices[0].message) return responseData.choices[0].message.content;
        if (typeof responseData === 'string') return responseData;
        
        return "(Generation returned empty)";
    } catch (err) {
        console.error(`[${MODULE_NAME}] generation failed:`, err);
        return "(Error during generation)";
    }
}

async function runPipeline(userInput) {
    toastr.info('Starting Polyceph Pipeline...', 'Polyceph');
    const contextVault = { 'user_input': userInput };

    try {
        for (let i = 0; i < settings.steps.length; i++) {
            const step = settings.steps[i];
            const isLastStep = i === settings.steps.length - 1;

            if (!step.nodes || step.nodes.length === 0) continue;

            // Group nodes by profile to minimize ST global switches and race conditions
            const profileGroups = {};
            step.nodes.forEach((node, nodeIndex) => {
                const pName = node.profile || 'Target';
                if (!profileGroups[pName]) profileGroups[pName] = [];
                profileGroups[pName].push({ node, nodeIndex });
            });

            const resultsByIndex = [];

            // Process each profile group sequentially
            for (const [profileId, groupNodes] of Object.entries(profileGroups)) {
                await switchProfile(profileId);
                // Allow ST UI state to settle profile load
                await new Promise(r => setTimeout(r, 250));

                // Execute all nodes for this profile in parallel
                const groupPromises = groupNodes.map(item => {
                    const { node, nodeIndex } = item;
                    let prompt = node.template;
                    for (const [key, val] of Object.entries(contextVault)) {
                        const regex = new RegExp(`{{${key}}}`, 'g');
                        prompt = prompt.replace(regex, val);
                    }
                    
                    return generateQuietly(node.profile, prompt).then(res => {
                        contextVault[`${step.id}_target_${nodeIndex + 1}`] = res;
                        const prof = availableProfiles.find(p => p.id === node.profile);
                        const profName = prof ? prof.name : (node.profile || 'Target');
                        resultsByIndex[nodeIndex] = `[${profName}]\n${res}`;
                    });
                });

                await Promise.all(groupPromises);
            }

            const combinedResult = resultsByIndex.join('\n\n---\n\n');
            contextVault[step.id] = combinedResult;

            if (step.persist) {
                const context = SillyTavern.getContext();
                await context.executeSlashCommandsWithOptions(`/sys [Polyceph Output: Step ${i+1}]\n${combinedResult}`, {
                    handleExecutionErrors: false, handleParserErrors: false
                });
            }

            if (isLastStep) {
                const stContext = SillyTavern.getContext();
                await stContext.executeSlashCommandsWithOptions(`/echo ${combinedResult}`, {
                    handleExecutionErrors: false, handleParserErrors: false
                });
            }
        }
        toastr.success('Pipeline finished.', 'Polyceph');
    } catch (e) {
        toastr.error('Pipeline execution encountered an error.', 'Polyceph');
        console.error(`[${MODULE_NAME}] Pipeline Error`, e);
    }
}


// -------------------------------------------------------------------------
// Interception Hook
// -------------------------------------------------------------------------

function interceptSend(e) {
    if (!settings.enabled) return; 

    const textarea = document.getElementById('send_textarea');
    if (!textarea) return;

    if (e.type === 'keydown' && (e.key !== 'Enter' || e.shiftKey)) {
        return;
    }

    const text = textarea.value.trim();
    if (!text) return; 

    e.preventDefault();
    e.stopImmediatePropagation();
    textarea.value = '';

    SillyTavern.getContext().executeSlashCommandsWithOptions(`/echo ${text}`, {});
    runPipeline(text);
}

function setupIntercepts() {
    const sendBtn = document.getElementById('send_but');
    const textArea = document.getElementById('send_textarea');

    if (sendBtn) sendBtn.addEventListener('click', interceptSend, true);
    if (textArea) textArea.addEventListener('keydown', interceptSend, true);
}


// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------

async function init() {
    console.log(`[${MODULE_NAME}] Initializing Polyceph v${VERSION}...`);

    loadSettings();
    await getAvailableProfiles();

    addSettingsUI();
    setupIntercepts();

    console.log(`[${MODULE_NAME}] Polyceph loaded.`);
}

if (typeof jQuery !== 'undefined') {
    jQuery(async () => { await init(); });
} else {
    window.addEventListener('DOMContentLoaded', init);
} 
