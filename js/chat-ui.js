import { settings, saveSettings } from './state.js';
import { MODULE_NAME } from './constants.js';

/**
 * Injects a compact pipeline selector into the SillyTavern chat form.
 */
export function injectChatPipelineSelector() {
    const rightForm = document.getElementById('rightSendForm');
    if (!rightForm) return;

    // Avoid double injection
    if (document.getElementById('polyceph-chat-pipeline-container')) {
        updateChatSelectorOptions();
        return;
    }

    const container = document.createElement('div');
    container.id = 'polyceph-chat-pipeline-container';
    container.className = 'polyceph-chat-pipeline-container';

    const select = document.createElement('select');
    select.id = 'polyceph-chat-pipeline-selector';
    select.className = 'polyceph-chat-pipeline-selector text_pole';
    select.title = 'Polyceph Pipeline';
    
    updateChatSelectorOptions(select);

    select.addEventListener('change', (e) => {
        settings.activePipelineId = e.target.value;
        saveSettings();
        
        // Synchronize with Settings UI if it exists
        const settingsSelector = document.getElementById('polyceph_pipeline_selector');
        if (settingsSelector) {
            settingsSelector.value = e.target.value;
            // Trigger change to update the rest of the settings UI
            settingsSelector.dispatchEvent(new Event('change'));
        }
    });

    const icon = document.createElement('span');
    icon.className = 'polyceph-chat-pipeline-icon';
    icon.innerText = '☍';
    container.appendChild(icon);
    container.appendChild(select);
    
    const sendBut = document.getElementById('send_but');
    if (sendBut) {
        rightForm.insertBefore(container, sendBut);
    } else {
        rightForm.appendChild(container);
    }
}

/**
 * Updates the options in the chat pipeline selector based on current settings.
 */
export function updateChatSelectorOptions(select) {
    if (!select) select = document.getElementById('polyceph-chat-pipeline-selector');
    if (!select) return;

    const noneSelected = settings.activePipelineId === 'none' ? 'selected' : '';
    let html = `<option value="none" ${noneSelected}>None</option>`;
    
    settings.pipelines.forEach(p => {
        const selected = p.id === settings.activePipelineId ? 'selected' : '';
        html += `<option value="${p.id}" ${selected}>${p.name}</option>`;
    });

    select.innerHTML = html;
    select.value = settings.activePipelineId;
}
