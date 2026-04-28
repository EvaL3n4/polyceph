import { settings, saveSettings } from './state.js';
import { MODULE_NAME } from './constants.js';
import { isPipelineActive, stopPipeline } from './engine.js';

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
    polySendBut.style.display = 'none';
    
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

    // Custom Stop Button
    const polyStopBut = document.createElement('div');
    polyStopBut.id = 'polyceph-stop-button';
    polyStopBut.className = 'polyceph-stop-button interactable';
    polyStopBut.title = 'Stop Polyceph Pipeline';
    polyStopBut.style.display = 'none';

    const polyStopIcon = document.createElement('i');
    polyStopIcon.className = 'fa-solid fa-circle-stop';
    polyStopBut.appendChild(polyStopIcon);

    const polyStopOverlay = document.createElement('span');
    polyStopOverlay.className = 'polyceph-send-button-overlay';
    polyStopOverlay.innerText = '☍';
    polyStopBut.appendChild(polyStopOverlay);

    polyStopBut.addEventListener('click', () => {
        stopPipeline();
    });

    const sendBut = document.getElementById('send_but');
    if (sendBut) {
        rightForm.insertBefore(container, sendBut);
        rightForm.insertBefore(polySendBut, sendBut);
        rightForm.insertBefore(polyStopBut, sendBut);
    } else {
        rightForm.appendChild(container);
        rightForm.appendChild(polySendBut);
        rightForm.appendChild(polyStopBut);
    }

    updateSendButtonVisibility();
}

/**
 * Updates the visibility of the custom send button and the standard ST button.
 */
export function updateSendButtonVisibility() {
    const polySendBut = document.getElementById('polyceph-send-button');
    const polyStopBut = document.getElementById('polyceph-stop-button');
    const stSendBut = document.getElementById('send_but');
    const stStopBut = document.getElementById('mes_stop');
    const container = document.getElementById('polyceph-chat-pipeline-container');

    if (!polySendBut || !polyStopBut || !stSendBut) return;

    const isActive = settings.activePipelineId !== 'none';
    const isIntercept = settings.interceptSend !== false;
    const isRunning = isPipelineActive();

    if (isActive) {
        if (container) container.style.display = 'inline-flex';
        
        if (isRunning) {
            // Pipeline running: show Polyceph stop button, hide everything else
            polyStopBut.style.display = 'flex';
            polySendBut.style.display = 'none';
            stSendBut.style.display = 'none';
            if (stStopBut) stStopBut.style.display = 'none'; // Hide ST stop button if we are using ours
        } else {
            // Pipeline not running
            polyStopBut.style.display = 'none';
            
            if (isIntercept) {
                // Legacy Mode: Use ST's button, hide ours
                polySendBut.style.display = 'none';
                // Note: ST might hide its own button if it's running its own thing, 
                // but if we aren't running, we let ST handle its own button visibility.
                stSendBut.style.display = ''; 
            } else {
                // Custom Button Mode: Show ours
                polySendBut.style.display = 'flex';
                stSendBut.style.display = '';
            }
        }
    } else {
        // Disabled: Hide all Polyceph UI
        if (container) container.style.display = 'none';
        polySendBut.style.display = 'none';
        polyStopBut.style.display = 'none';
        stSendBut.style.display = '';
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
