import { availableProfiles, settings, saveSettings, getAvailableProfiles } from './state.js';
import { autoResizeTextarea, generateId } from './utils.js';

export function generateThoughtsHTML(thoughtsArray) {
    if (!thoughtsArray || thoughtsArray.length === 0) return '';
    
    const thoughtsId = `polyceph_thoughts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const htmlBlocks = thoughtsArray.map(t => {
        let contentHtml = t.content;
        const stContext = SillyTavern.getContext();
        if (typeof stContext.messageFormatting === 'function') {
            contentHtml = stContext.messageFormatting(contentHtml, 'Polyceph', false, false);
        } else {
            contentHtml = contentHtml.replace(/\n/g, '<br>');
        }
        
        const openClass = t.isSilent ? '' : 'polyceph-item-open';
        const silentClass = t.isSilent ? 'polyceph-silent-thought' : '';
        
        return `<div class="polyceph-generated-thought ${openClass} ${silentClass}">
            <div class="polyceph-generated-thought-name" style="cursor:pointer;" onclick="this.parentElement.classList.toggle('polyceph-item-open');">
                <span class="polyceph-item-toggle-icon">▶</span> ${t.title}
            </div>
            <div class="polyceph-generated-thought-content mes_text">${contentHtml}</div>
        </div>`;
    }).join('\n<div class="polyceph-thought-separator"></div>\n');

    return `<div id="${thoughtsId}" class="polyceph-thoughts">
        <div class="polyceph-thoughts-details">
            <div class="polyceph-thought-summary">
                <div class="polyceph-thought-summary-container" onclick="this.parentElement.parentElement.classList.toggle('polyceph-thoughts-open');">
                    <div class="polyceph-thought-summary-title"><b>Polyceph Reasoning</b></div>
                </div>
            </div>
            <div class="polyceph-thought-items">
                ${htmlBlocks}
            </div>
        </div>
    </div>`;
}

export function renderPolycephThoughts() {
    const context = SillyTavern.getContext();
    if (!context || !context.chat) return;

    $('#chat .mes').each((_, messageElement) => {
        if (messageElement.getAttribute('polyceph_thoughts_rendered') === 'true') {
            const thoughtsId = messageElement.getAttribute('polyceph_thoughts_id');
            if (thoughtsId) {
                const container = document.getElementById(thoughtsId);
                if (container) {
                    try {
                        // If it's already inside this message, we don't need to do anything
                        if (messageElement.contains(container)) return;

                        // Otherwise, reattach if it was moved/detached by an ST re-render
                        const $mesText = $(messageElement).find('.mes_text').first();
                        if ($mesText.length > 0) {
                            $mesText.before(container);
                        } else {
                            $(messageElement).append(container);
                        }
                    } catch (e) {
                        console.warn('[polyceph] Failed to reattach thoughts container:', e);
                    }
                }
            }
            return;
        }

        const mesId = messageElement.getAttribute('mesid');
        const chatMsg = context.chat[mesId];
        
        if (!chatMsg) return;

        let thoughts = null;
        if (chatMsg.swipe_info && chatMsg.swipe_id !== undefined && chatMsg.swipe_info[chatMsg.swipe_id]) {
            thoughts = chatMsg.swipe_info[chatMsg.swipe_id]?.extra?.polyceph_thoughts;
        }
        if (!thoughts && chatMsg.extra) {
            thoughts = chatMsg.extra.polyceph_thoughts;
        }

        if (!thoughts || thoughts.length === 0) {
            messageElement.setAttribute('polyceph_thoughts_rendered', 'true');
            return;
        }

        const thoughtsHtml = generateThoughtsHTML(thoughts);
        const $thoughtsContainer = $(thoughtsHtml);
        const thoughtsId = $thoughtsContainer.attr('id');
        
        const $mesText = $(messageElement).find('.mes_text').first();
        if ($mesText.length > 0) {
            $mesText.before($thoughtsContainer);
        } else {
            $(messageElement).append($thoughtsContainer);
        }
        
        messageElement.setAttribute('polyceph_thoughts_rendered', 'true');
        messageElement.setAttribute('polyceph_thoughts_id', thoughtsId);
        
        if (chatMsg.is_system && chatMsg.mes === '') {
            messageElement.style.display = 'none';
        }
    });
}

export function renderTask(stepId, task) {
    const profileOptions = `<option value="none">(Template Only - No LLM)</option>` +
        availableProfiles.map(p => `<option value="${p.id}" ${p.id === task.profile ? 'selected' : ''}>${p.name}</option>`).join('');

    return `
        <div class="polyceph-node-card" data-node-id="${task.id}">
            <div class="polyceph-node-header" style="display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; gap: 5px; align-items: center;">
                    <input type="text" class="polyceph-node-label-input text_pole" data-node-id="${task.id}" placeholder="Task Label..." value="${task.label || ''}" style="flex: 1; min-width: 100px; padding: 2px 5px;" />
                    <select class="polyceph-profile-select text_pole" data-node-id="${task.id}" style="flex: 2; max-width: 250px;">
                        ${profileOptions}
                    </select>
                    <i class="fa-solid fa-times polyceph-del-node" data-node-id="${task.id}" data-step-id="${stepId}"></i>
                </div>
                <div style="display: flex; align-items: center; gap: 15px; padding-left: 2px; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" class="polyceph-node-system-checkbox" data-step-id="${stepId}" data-node-id="${task.id}" ${task.useSystem ? 'checked' : ''} title="Include System Prompt + Context">
                        <label style="font-size: 0.8em; cursor: pointer;" title="Include System Prompt + Context">Include Sys</label>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" class="polyceph-node-strip-think-checkbox" data-step-id="${stepId}" data-node-id="${task.id}" ${task.stripThink ? 'checked' : ''} title="Strip <think> tags from output">
                        <label style="font-size: 0.8em; cursor: pointer;" title="Strip <think> tags from output">Strip Think</label>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" class="polyceph-node-persist-checkbox" data-step-id="${stepId}" data-node-id="${task.id}" ${task.persist ? 'checked' : ''} title="Post this result to chat during execution">
                        <label style="font-size: 0.8em; cursor: pointer;" title="Post this result to chat during execution">Pre-message</label>
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
    const stepsContainer = document.getElementById('polyceph_steps_container');
    if (stepsContainer) {
        stepsContainer.innerHTML = settings.steps.map((s, i) => renderStep(s, i)).join('');

        // Auto-resize all textareas after render - with a small delay for layout settlement
        setTimeout(() => {
            stepsContainer.querySelectorAll('textarea').forEach(textarea => {
                autoResizeTextarea(textarea);
            });
        }, 150);

        bindStepEvents();
    }
}

export function bindStepEvents() {
    const container = document.getElementById('polyceph_settings_container');
    if (!container) return;

    // Node profile select
    container.querySelectorAll('.polyceph-profile-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of settings.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.profile = e.target.value; break; }
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
            const step = settings.steps.find(s => s.id === stepId);
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
            const step = settings.steps.find(s => s.id === stepId);
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
            const step = settings.steps.find(s => s.id === stepId);
            if (step) {
                step.tasks.push({ id: 'task_' + generateId(), profile: '', template: '{{user_input}}' });
                saveSettings();
                updateUI();
            }
        });
    });

    // Persist Toggle
    document.querySelectorAll('.polyceph-node-label-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of settings.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.label = e.target.value; break; }
            }
            SillyTavern.getContext().saveSettingsDebounced();
        });
    });

    document.querySelectorAll('.polyceph-node-system-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of settings.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.useSystem = e.target.checked; break; }
            }
            SillyTavern.getContext().saveSettingsDebounced();
        });
    });

    document.querySelectorAll('.polyceph-node-strip-think-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of settings.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.stripThink = e.target.checked; break; }
            }
            SillyTavern.getContext().saveSettingsDebounced();
        });
    });

    document.querySelectorAll('.polyceph-step-label-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const stepId = e.target.getAttribute('data-step-id');
            const step = settings.steps.find(s => s.id === stepId);
            if (step) step.label = e.target.value;
            SillyTavern.getContext().saveSettingsDebounced();
        });
    });

    document.querySelectorAll('.polyceph-node-persist-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of settings.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.persist = e.target.checked; break; }
            }
            SillyTavern.getContext().saveSettingsDebounced();
        });
    });

    document.querySelectorAll('.polyceph-node-character-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of settings.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.isCharacter = e.target.checked; break; }
            }
            SillyTavern.getContext().saveSettingsDebounced();
        });
    });

    // Remove Step
    container.querySelectorAll('.polyceph-del-step').forEach(btn => {
        btn.addEventListener('click', (e) => {
            settings.steps.splice(settings.steps.findIndex(s => s.id === e.currentTarget.getAttribute('data-step-id')), 1);
            saveSettings();
            updateUI();
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
                                <li><code>{{chat_history:N}}</code> - Retrieves the last N messages from chat.</li>
                                <li><code>{{s1}}</code>, <code>{{s2}}</code> - Combined output of a step. (Alias: <code>{{step_1}}</code>)</li>
                                <li><code>{{s1k1}}</code>, <code>{{s2k1}}</code> - Output of an individual Task. (Legacy: <code>{{s1t1}}</code>)</li>
                                <li><code>{{YourCustomLabel}}</code> - Binds to any custom Task/Step label.</li>
                                <li><code>{{char}}</code>, <code>{{user}}</code>, <code>{{personality}}</code>, <code>{{description}}</code> - Standard character card macros.</li>
                                <li><code>{{wi}}</code> or <code>{{world_info}}</code> - Relevant Lorebook entries based on chat context.</li>
                            </ul>
                        </div>
                    </div>
                    
                    <button id="polyceph_refresh_profiles" class="menu_button" style="margin-bottom: 15px;">
                        <i class="fa-solid fa-refresh"></i> Refresh Profiles
                    </button>
                    
                    <div style="margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" id="polyceph_enabled" ${settings.enabled ? 'checked' : ''}>
                        <label for="polyceph_enabled"><b>Enable Polyceph</b></label>
                    </div>

                    <div style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 15px;">
                        ${renderNeoSlider('Request Delay (ms)', 'polyceph_delay', settings.delayMs || 0, 0, 5000, 50)}
                        ${renderNeoSlider('Model Timeout (ms)', 'polyceph_generation_timeout', settings.generationTimeoutMs !== undefined ? settings.generationTimeoutMs : 60000, 0, 300000, 1000)}
                    </div>

                    <div style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 15px;">
                        ${renderNeoSlider('Max Retries', 'polyceph_max_retries', settings.maxRetries !== undefined ? settings.maxRetries : 3, 0, 10, 1)}
                        ${renderNeoSlider('Retry Delay (ms)', 'polyceph_retry_delay', settings.retryDelayMs !== undefined ? settings.retryDelayMs : 2000, 0, 10000, 100)}
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

    // Bind Neo Sliders
    const bindSlider = (id, settingKey) => {
        const slider = document.getElementById(id);
        const input = document.getElementById(id + '_value');
        if (!slider || !input) return;

        // Sync Slider -> Input & Setting
        slider.addEventListener('input', (e) => {
            const val = e.target.value;
            input.value = val;
            settings[settingKey] = parseInt(val) || 0;
            SillyTavern.getContext().saveSettingsDebounced();
        });

        // Sync Input -> Slider & Setting
        input.addEventListener('change', (e) => {
            const val = e.target.value;
            slider.value = val;
            settings[settingKey] = parseInt(val) || 0;
            SillyTavern.getContext().saveSettingsDebounced();
        });
    };

    bindSlider('polyceph_delay', 'delayMs');
    bindSlider('polyceph_generation_timeout', 'generationTimeoutMs');
    bindSlider('polyceph_max_retries', 'maxRetries');
    bindSlider('polyceph_retry_delay', 'retryDelayMs');

    // Toggle placeholders visibility
    document.getElementById('polyceph_placeholders_toggle').addEventListener('click', () => {
        const content = document.getElementById('polyceph_placeholders_content');
        const icon = document.querySelector('#polyceph_placeholders_toggle i');
        const isActive = content.classList.toggle('active');
        icon.classList.toggle('fa-chevron-down', !isActive);
        icon.classList.toggle('fa-chevron-up', isActive);
    });

    document.getElementById('polyceph_enabled')?.addEventListener('change', (e) => {
        settings.enabled = e.target.checked;
        SillyTavern.getContext().saveSettingsDebounced();
    });

    document.getElementById('polyceph_add_step_btn')?.addEventListener('click', () => {
        settings.steps.push({
            id: 'step_' + generateId(),
            tasks: [{ id: 'task_' + generateId(), profile: '', template: '{{user_input}}' }]
        });
        saveSettings();
        updateUI();
    });

    document.getElementById('polyceph_refresh_profiles').addEventListener('click', async () => {
        await getAvailableProfiles();
        updateUI();
        toastr.success(`Profiles refreshed.`, 'Polyceph');
    });
}
