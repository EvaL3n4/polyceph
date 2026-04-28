import { settings, saveSettings } from './state.js';
import { MODULE_NAME } from './constants.js';

/**
 * Injects a compact pipeline selector and custom send button into the SillyTavern chat form.
 */
export function injectChatPipelineSelector(sendHandler) {
    const rightForm = document.getElementById('rightSendForm');
    if (!rightForm) return;

    // Avoid double injection
    if (document.getElementById('polyceph-chat-pipeline-container')) {
        updateChatSelectorOptions();
        updateSendButtonVisibility();
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
        
        updateSendButtonVisibility();

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

    // Custom Send Button
    const polySendBut = document.createElement('div');
    polySendBut.id = 'polyceph-send-button';
    polySendBut.className = 'polyceph-send-button interactable';
    polySendBut.title = 'Send via Polyceph';
    polySendBut.style.display = 'none'; // Hidden by default, updated by updateSendButtonVisibility
    
    const polySendIcon = document.createElement('i');
    polySendIcon.className = 'fa-solid fa-paper-plane';
    polySendBut.appendChild(polySendIcon);

    const polySendOverlay = document.createElement('span');
    polySendOverlay.className = 'polyceph-send-button-overlay';
    polySendOverlay.innerText = '☍';
    polySendBut.appendChild(polySendOverlay);

    if (sendHandler) {
        polySendBut.addEventListener('click', (e) => {
            sendHandler(e);
        });
    }

    const sendBut = document.getElementById('send_but');
    if (sendBut) {
        rightForm.insertBefore(container, sendBut);
        rightForm.insertBefore(polySendBut, sendBut);
    } else {
        rightForm.appendChild(container);
        rightForm.appendChild(polySendBut);
    }

    updateSendButtonVisibility();
}

/**
 * Updates the visibility of the custom send button and the standard ST button.
 */
export function updateSendButtonVisibility() {
    const polySendBut = document.getElementById('polyceph-send-button');
    const stSendBut = document.getElementById('send_but');
    const container = document.getElementById('polyceph-chat-pipeline-container');

    if (!polySendBut || !stSendBut) return;

    const isActive = settings.activePipelineId !== 'none';
    const isIntercept = settings.interceptSend !== false;

    if (isActive) {
        if (container) container.style.display = 'inline-flex';
        
        if (isIntercept) {
            // Legacy Mode: Use ST's button, hide ours
            polySendBut.style.display = 'none';
            // We don't hide ST's button here because we want to intercept it
            // stSendBut.classList.remove('displayNone'); // ST handles this itself mostly
        } else {
            // Custom Button Mode: Show ours
            polySendBut.style.display = 'flex';
            // We could hide ST's button, but user might want to send normally too
            // For now, let's keep both visible so they are truly distinct options.
        }
    } else {
        // Disabled: Hide all Polyceph UI
        if (container) container.style.display = 'none';
        polySendBut.style.display = 'none';
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
