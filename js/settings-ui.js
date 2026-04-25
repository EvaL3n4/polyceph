import { availableProfiles, availablePresets, settings, saveSettings, getAvailableProfiles, getActivePipeline, createPipeline, deletePipeline, refreshPresets } from './state.js';
import { autoResizeTextarea, generateId } from './utils.js';
import { MODULE_NAME } from './constants.js';
import { syncHiddenMessageVisibility } from './ui.js';

export function renderTask(stepId, task) {
    const profileOptions = `<option value="none">(Template Only - No LLM)</option>` +
        availableProfiles.map(p => `<option value="${p.id}" ${p.id === task.profile ? 'selected' : ''}>${p.name}</option>`).join('');

    const presetOptions = `<option value="Current" ${(!task.preset || task.preset === 'Current') ? 'selected' : ''}>Current Preset</option>` +
        availablePresets.map(p => `<option value="${p}" ${p === task.preset ? 'selected' : ''}>${p}</option>`).join('');

    return `
        <div class="polyceph-node-card" data-node-id="${task.id}">
            <div class="polyceph-node-header" style="display: flex; flex-direction: column; gap: 8px;">
                <div class="polyceph-node-header-label-row">
                    <input type="text" class="polyceph-node-label-input text_pole" data-node-id="${task.id}" placeholder="Task Label..." value="${task.label || ''}" style="flex: 1; min-width: 100px; padding: 2px 5px;" />
                    <i class="fa-solid fa-times polyceph-del-node" data-node-id="${task.id}" data-step-id="${stepId}"></i>
                </div>
                <div class="polyceph-node-header-controls">
                    <select class="polyceph-profile-select text_pole" data-node-id="${task.id}" style="flex: 1; min-width: 150px;">
                        ${profileOptions}
                    </select>
                    <select class="polyceph-preset-select text_pole" data-node-id="${task.id}" style="flex: 1; min-width: 150px;" title="Override the API preset for this task">
                        ${presetOptions}
                    </select>
                </div>
                <div style="display: flex; align-items: center; gap: 15px; padding-left: 2px; flex-wrap: wrap;">

                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" class="polyceph-node-persist-checkbox" data-step-id="${stepId}" data-node-id="${task.id}" ${task.persist ? 'checked' : ''} title="Display this task result as Thinking">
                        <label style="font-size: 0.8em; cursor: pointer;" title="Display this task result as Thinking">Thinking</label>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" class="polyceph-node-character-checkbox" data-step-id="${stepId}" data-node-id="${task.id}" ${task.isCharacter ? 'checked' : ''} title="If persisted, use character name/avatar">
                        <label style="font-size: 0.8em; cursor: pointer;" title="If persisted, use character name/avatar">Character Message</label>
                    </div>
                </div>
            </div>
            <textarea class="polyceph-node-template text_pole" data-step="${stepId}" data-node="${task.id}" placeholder="Use {{user_input}} or {{chat_history:2}}...">${task.template || ''}</textarea>
        </div>
    `;
}

export function renderStep(step, index) {
    const tasksHtml = step.tasks.map(n => renderTask(step.id, n)).join('');

    return `
        <div class="polyceph-step-card" data-step-id="${step.id}">
            <div class="polyceph-step-header" style="display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <b>Step ${index + 1} </b>
                    <input type="text" class="polyceph-step-label-input text_pole" data-step-id="${step.id}" placeholder="Custom Label..." value="${step.label || ''}" style="flex: 1; max-width: 200px; padding: 2px 5px;" />
                    <i class="fa-solid fa-trash polyceph-del-step" data-step-id="${step.id}" style="margin-left: auto;"></i>
                </div>
            </div>
            <div class="polyceph-nodes-list">
                ${tasksHtml}
            </div>
            <button class="menu_button polyceph-add-node-btn" data-step="${step.id}">
                <i class="fa-solid fa-plus"></i> Add Profile Task
            </button>
        </div>
    `;
}

export function updateUI() {
    const activePipeline = getActivePipeline();
    const stepsContainer = document.getElementById('polyceph_steps_container');
    if (stepsContainer) {
        stepsContainer.innerHTML = activePipeline.steps.map((s, i) => renderStep(s, i)).join('');

        // Auto-resize all textareas after render
        setTimeout(() => {
            stepsContainer.querySelectorAll('textarea').forEach(textarea => {
                autoResizeTextarea(textarea);
            });
        }, 150);

        bindStepEvents();
    }

    // Update pipeline selector
    const selector = document.getElementById('polyceph_pipeline_selector');
    if (selector) {
        const noneSelected = settings.activePipelineId === 'none' ? 'selected' : '';
        selector.innerHTML = `<option value="none" ${noneSelected}>None (Disabled)</option>` +
            settings.pipelines.map(p =>
                `<option value="${p.id}" ${p.id === settings.activePipelineId ? 'selected' : ''}>${p.name}</option>`
            ).join('');
    }

    // Update active pipeline name input
    const nameInput = document.getElementById('polyceph_active_pipeline_name');
    if (nameInput) {
        nameInput.value = activePipeline.name;
    }
}

export function bindStepEvents() {
    const container = document.getElementById('polyceph_settings_container');
    if (!container) return;

    const activePipeline = getActivePipeline();

    // Node profile select
    container.querySelectorAll('.polyceph-profile-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.profile = e.target.value; break; }
            }
            saveSettings();
        });
    });

    // Node preset select
    container.querySelectorAll('.polyceph-preset-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.preset = e.target.value; break; }
            }
            saveSettings();
        });
    });

    // Node template textarea
    container.querySelectorAll('.polyceph-node-template').forEach(textarea => {
        textarea.addEventListener('input', (e) => {
            autoResizeTextarea(e.target);
            const stepId = e.target.getAttribute('data-step');
            const nodeId = e.target.getAttribute('data-node');
            const step = activePipeline.steps.find(s => s.id === stepId);
            const task = step?.tasks.find(n => n.id === nodeId);
            if (task) {
                task.template = e.target.value;
                saveSettings();
            }
        });
    });

    // Remove Node
    container.querySelectorAll('.polyceph-del-node').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const stepId = e.currentTarget.getAttribute('data-step-id');
            const nodeId = e.currentTarget.getAttribute('data-node-id');
            const step = activePipeline.steps.find(s => s.id === stepId);
            if (step) {
                step.tasks = step.tasks.filter(n => n.id !== nodeId);
                saveSettings();
                updateUI();
            }
        });
    });

    // Add Node
    container.querySelectorAll('.polyceph-add-node-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const stepId = e.currentTarget.getAttribute('data-step');
            const step = activePipeline.steps.find(s => s.id === stepId);
            if (step) {
                step.tasks.push({ id: 'task_' + generateId(), profile: '', preset: 'Current', template: '{{user_input}}' });
                saveSettings();
                updateUI();
            }
        });
    });

    // Label inputs
    document.querySelectorAll('.polyceph-node-label-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.label = e.target.value; break; }
            }
            saveSettings();
        });
    });

    document.querySelectorAll('.polyceph-step-label-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const stepId = e.target.getAttribute('data-step-id');
            const step = activePipeline.steps.find(s => s.id === stepId);
            if (step) step.label = e.target.value;
            saveSettings();
        });
    });

    // Checkboxes




    document.querySelectorAll('.polyceph-node-persist-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.persist = e.target.checked; break; }
            }
            saveSettings();
        });
    });

    document.querySelectorAll('.polyceph-node-character-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.isCharacter = e.target.checked; break; }
            }
            saveSettings();
        });
    });

    // Remove Step
    container.querySelectorAll('.polyceph-del-step').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const stepId = e.currentTarget.getAttribute('data-step-id');
            const idx = activePipeline.steps.findIndex(s => s.id === stepId);
            if (idx !== -1) {
                activePipeline.steps.splice(idx, 1);
                saveSettings();
                updateUI();
            }
        });
    });
}

function renderNeoSlider(label, id, value, min, max, step) {
    return `
        <div class="alignitemscenter flex-container flexFlowColumn flexGrow flexShrink gap0 flexBasis48p">
            <small>
                <span style="font-weight: bold; margin-bottom: 2px; display: block;">${label}</span>
            </small>
            <input class="neo-range-slider" type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
            <input class="neo-range-input" type="number" id="${id}_value" data-for="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
        </div>
    `;
}

export function createSettingsHTML() {
    return `
        <div class="polyceph-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Polyceph</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="polyceph-header">
                        Reasoning pipeline options:
                    </div>
                    
                    <div style="margin-bottom: 15px; display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="polyceph_show_hidden_checkbox" ${settings.showHiddenMessages ? 'checked' : ''}>
                            <label for="polyceph_show_hidden_checkbox" style="cursor: pointer;">Show Hidden Background Messages</label>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="polyceph_show_reasoning_checkbox" ${settings.showReasoning !== false ? 'checked' : ''}>
                            <label for="polyceph_show_reasoning_checkbox" style="cursor: pointer;">Show Polyceph Reasoning Blocks</label>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label for="polyceph_prompt_input" style="font-weight: bold; display: block; margin-bottom: 5px;">Polyceph Prompt</label>
                        <textarea id="polyceph_prompt_input" class="text_pole" style="width: 100%; min-height: 80px; font-family: monospace;" placeholder="Global context or instructions...">${settings.polycephPrompt || ''}</textarea>
                    </div>
                    
                    <div style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 15px;">
                        ${renderNeoSlider('Request Delay (ms)', 'polyceph_delay', settings.delayMs || 0, 0, 5000, 50)}
                        ${renderNeoSlider('Model Timeout (ms)', 'polyceph_generation_timeout', settings.generationTimeoutMs !== undefined ? settings.generationTimeoutMs : 60000, 0, 300000, 1000)}
                    </div>

                    <div style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 15px;">
                        ${renderNeoSlider('Max Retries', 'polyceph_max_retries', settings.maxRetries !== undefined ? settings.maxRetries : 3, 0, 10, 1)}
                        ${renderNeoSlider('Retry Delay (ms)', 'polyceph_retry_delay', settings.retryDelayMs !== undefined ? settings.retryDelayMs : 2000, 0, 10000, 100)}
                    </div>

                    <button id="polyceph_refresh_profiles" class="menu_button" style="margin-bottom: 15px;">
                        <i class="fa-solid fa-refresh"></i> Refresh Profiles
                    </button>

                    <div class="polyceph-placeholders-container">
                        <div class="polyceph-placeholders-header" id="polyceph_placeholders_toggle">
                            <b>Available Placeholders</b>
                            <i class="fa-solid fa-chevron-down"></i>
                        </div>
                        <div class="polyceph-placeholders-content" id="polyceph_placeholders_content">
                            <ul style="margin: 0; padding-left: 20px;">
                                <li><code>{{user_input}}</code> - Original text from the send box.</li>
                                <li><code>{{chat_history}}</code> - All chat messages - see below for advanced use.</li>
                                <li><code>{{s1}}</code>, <code>{{s2}}</code> - Combined output of all tasks in a previous Step.</li>
                                <li><code>{{TaskLabel}}</code> - Output of a specific task (using its custom label).</li>
                                <li><code>{{system_prompt}}</code> - The Main Prompt from SillyTavern Advanced Formatting.</li>
                                <li><code>{{polyceph_prompt}}</code> - The global Polyceph Prompt defined above.</li>
                                <li><code>{{char}}</code>, <code>{{user}}</code>, <code>{{persona}}</code>, <code>{{personality}}</code> - Standard character macros.</li>
                                <li><code>{{wi}}</code> or <code>{{world_info}}</code> - Relevant Lorebook entries based on chat context.</li>
                                <li><code>{{cc_all_prompts}}</code> - Comprehensive ST prompt list (includes all enabled markers, history, examples).</li>
                                <li><code>{{cc_main_prompt}}</code>, <code>{{cc_aux_prompt}}</code> - Specific CC Prompts.</li>
                                <li><code>{{cc_post_history_instructions}}</code> - CC Post-History instructions.</li>
                                <li><code>{{cc_enhance_definitions}}</code> - CC Enhance Definitions prompt.</li>
                            </ul>
                            <div style="margin-top: 10px; border-top: 1px solid var(--white10a); padding-top: 10px;">
                                <b style="font-size: 0.9em; opacity: 0.8;">Advanced: Chat History</b>
                                <div style="font-size: 0.85em; opacity: 0.9; margin-top: 5px;">
                                    Format: <code>{{chat_history|last:10|bg_last:2|live:true}}</code>
                                    <ul style="margin: 5px 0 0 0; padding-left: 15px;">
                                        <li><code>last:N</code> - Limit total messages to N.</li>
                                        <li><code>bg_last:N</code> - Keep only the last N background messages (interspersed).</li>
                                        <li><code>live:true</code> - Use chat *during* pipeline runs, not a snapshot of prior to the run. (includes pipeline results).</li>
                                    </ul>
                                </div>
                            </div>
                            <div style="margin-top: 10px; border-top: 1px solid var(--white10a); padding-top: 10px;">
                                <b style="font-size: 1em; opacity: 0.8;">Post-Processing Tags (in Model Output)</b>
                                <ul style="margin: 5px 0 0 0; padding-left: 20px; font-size: 0.9em; opacity: 0.9;">
                                    <li><code>&lt;think&gt;...&lt;/think&gt;</code> - Stripped if "Strip Thinking" is enabled on the task.</li>
                                    <li><code>&lt;ramble&gt;...&lt;/ramble&gt;</code> - Renders as a reasoning card.</li>
                                    <li><code>&lt;background&gt;...&lt;/background&gt;</code> - Renders as a hidden background message.</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    <div class="polyceph-step-card polyceph-pipeline-manager" style="margin-top: 20px;">
                        <div class="polyceph-step-header" style="display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <b style="min-width: 120px;">Active Pipeline</b>
                                <select id="polyceph_pipeline_selector" class="text_pole" style="flex: 1;"></select>
                                <i id="polyceph_new_pipeline_btn" class="fa-solid fa-plus" style="cursor: pointer; margin-left: 5px;" title="Create New Pipeline"></i>
                                <i id="polyceph_del_pipeline_btn" class="fa-solid fa-trash" style="cursor: pointer; margin-left: 5px; color: #ff4d4d;" title="Delete Current Pipeline"></i>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <b style="min-width: 120px;">Pipeline Name</b>
                                <input type="text" id="polyceph_active_pipeline_name" class="text_pole" style="flex: 1; padding: 2px 5px;" placeholder="Pipeline Name..." />
                            </div>
                        </div>
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

export function addSettingsUI() {
    const container = document.getElementById('extensions_settings');
    if (!container) return;

    const existing = document.getElementById('polyceph_settings_container');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.id = 'polyceph_settings_container';
    wrapper.innerHTML = createSettingsHTML();
    container.appendChild(wrapper);

    updateUI();

    // Bind Global Settings
    const bindSlider = (id, settingKey) => {
        const slider = document.getElementById(id);
        const input = document.getElementById(id + '_value');
        if (!slider || !input) return;

        slider.addEventListener('input', (e) => {
            const val = e.target.value;
            input.value = val;
            settings[settingKey] = parseInt(val) || 0;
            saveSettings();
        });

        input.addEventListener('change', (e) => {
            const val = e.target.value;
            slider.value = val;
            settings[settingKey] = parseInt(val) || 0;
            saveSettings();
        });
    };

    bindSlider('polyceph_delay', 'delayMs');
    bindSlider('polyceph_generation_timeout', 'generationTimeoutMs');
    bindSlider('polyceph_max_retries', 'maxRetries');
    bindSlider('polyceph_retry_delay', 'retryDelayMs');



    // Global settings
    document.getElementById('polyceph_show_hidden_checkbox')?.addEventListener('change', (e) => {
        settings.showHiddenMessages = e.target.checked;
        syncHiddenMessageVisibility();
        saveSettings();
    });

    document.getElementById('polyceph_show_reasoning_checkbox')?.addEventListener('change', (e) => {
        settings.showReasoning = e.target.checked;
        syncHiddenMessageVisibility();
        saveSettings();
    });

    document.getElementById('polyceph_prompt_input')?.addEventListener('input', (e) => {
        settings.polycephPrompt = e.target.value;
        saveSettings();
    });

    // Pipeline Manager Events
    document.getElementById('polyceph_pipeline_selector')?.addEventListener('change', (e) => {
        settings.activePipelineId = e.target.value;
        saveSettings();
        updateUI();
    });

    document.getElementById('polyceph_new_pipeline_btn')?.addEventListener('click', () => {
        createPipeline();
        updateUI();
    });

    document.getElementById('polyceph_del_pipeline_btn')?.addEventListener('click', () => {
        if (deletePipeline(settings.activePipelineId)) {
            updateUI();
        } else {
            toastr.error('Cannot delete the last pipeline.', 'Polyceph');
        }
    });

    document.getElementById('polyceph_active_pipeline_name')?.addEventListener('input', (e) => {
        const pipeline = getActivePipeline();
        if (pipeline) {
            pipeline.name = e.target.value;
            saveSettings();
            // Update selector option text without full redraw if possible, 
            // but updateUI is safer for now.
            const selector = document.getElementById('polyceph_pipeline_selector');
            const opt = selector?.querySelector(`option[value="${pipeline.id}"]`);
            if (opt) opt.textContent = pipeline.name;
        }
    });

    // Placeholder toggle
    document.getElementById('polyceph_placeholders_toggle')?.addEventListener('click', () => {
        const content = document.getElementById('polyceph_placeholders_content');
        const icon = document.querySelector('#polyceph_placeholders_toggle i');
        const isActive = content.classList.toggle('active');
        icon.classList.toggle('fa-chevron-down', !isActive);
        icon.classList.toggle('fa-chevron-up', isActive);
    });

    // Pipeline Steps
    document.getElementById('polyceph_add_step_btn')?.addEventListener('click', () => {
        const pipeline = getActivePipeline();
        pipeline.steps.push({
            id: 'step_' + generateId(),
            tasks: [{ id: 'task_' + generateId(), profile: '', preset: 'Current', template: '{{user_input}}' }]
        });
        saveSettings();
        updateUI();
    });

    document.getElementById('polyceph_refresh_profiles')?.addEventListener('click', async () => {
        await getAvailableProfiles();
        refreshPresets();
        toastr.success(`Found ${availableProfiles.length} profiles, ${availablePresets.length} presets.`, 'Polyceph');
        updateUI();
    });
}
