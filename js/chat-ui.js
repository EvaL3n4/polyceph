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

    const label = document.createElement('span');
    label.id = 'polyceph-chat-pipeline-label';
    label.className = 'polyceph-chat-pipeline-label';
    label.title = 'Polyceph Pipeline';
    
    const dropdown = document.createElement('div');
    dropdown.id = 'polyceph-chat-pipeline-dropdown';
    dropdown.className = 'polyceph-custom-dropdown';

    const icon = document.createElement('span');
    icon.className = 'polyceph-chat-pipeline-icon';
    icon.innerText = '☍';
    
    const toggleMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Populate dropdown
        let html = `<div class="polyceph-dropdown-item ${settings.activePipelineId === 'none' ? 'selected' : ''}" data-value="none">None</div>`;
        settings.pipelines.forEach(p => {
            const isSelected = p.id === settings.activePipelineId;
            html += `<div class="polyceph-dropdown-item ${isSelected ? 'selected' : ''}" data-value="${p.id}">${p.name}</div>`;
        });
        dropdown.innerHTML = html;

        // Position dropdown relative to container
        const rect = container.getBoundingClientRect();
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = 'auto';
        dropdown.style.bottom = `${window.innerHeight - rect.top + 5}px`;

        // Ensure it's in the body for z-index/clipping protection
        if (dropdown.parentElement !== document.body) {
            document.body.appendChild(dropdown);
        }

        dropdown.classList.toggle('active');

        // Bind items
        dropdown.querySelectorAll('.polyceph-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const val = e.target.getAttribute('data-value');
                settings.activePipelineId = val;
                saveSettings();
                updateChatSelectorOptions(); 
                updateSendButtonVisibility();
                dropdown.classList.remove('active');

                // Sync with settings UI
                const settingsSelector = document.getElementById('polyceph_pipeline_selector');
                if (settingsSelector) {
                    settingsSelector.value = val;
                    settingsSelector.dispatchEvent(new Event('change'));
                }
            });
        });
    };

    icon.addEventListener('click', toggleMenu);
    label.addEventListener('click', toggleMenu);

    // Global click to close dropdown
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && !icon.contains(e.target) && !label.contains(e.target)) {
            dropdown.classList.remove('active');
        }
    });

    container.appendChild(icon);
    container.appendChild(label);
    container.appendChild(dropdown);

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

    // Pipeline Selector visibility
    if (container) {
        if (isActive && settings.showPipelineSelector !== false) {
            container.classList.remove('polyceph-hidden');
            
            // Icon visibility
            const icon = container.querySelector('.polyceph-chat-pipeline-icon');
            if (icon) icon.style.display = (settings.showPipelineIcon !== false) ? 'flex' : 'none';
            
            // Label visibility (Compact mode)
            const label = container.querySelector('#polyceph-chat-pipeline-label');
            if (label) {
                if (settings.compactSelectorMode) {
                    label.classList.add('polyceph-hidden');
                } else {
                    label.classList.remove('polyceph-hidden');
                }
            }
        } else {
            container.classList.add('polyceph-hidden');
        }
    }

    if (isActive) {
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
                stSendBut.style.display = ''; 
            } else {
                // Custom Button Mode: Show ours
                polySendBut.style.display = 'flex';
                stSendBut.style.display = '';
            }
        }
    } else {
        // Disabled: Hide Polyceph buttons
        polySendBut.style.display = 'none';
        polyStopBut.style.display = 'none';
        stSendBut.style.display = '';
    }
}

/**
 * Updates the options in the chat pipeline selector based on current settings.
 */
export function updateChatSelectorOptions() {
    const label = document.getElementById('polyceph-chat-pipeline-label');
    if (!label) return;

    if (settings.activePipelineId === 'none') {
        label.innerText = 'None';
    } else {
        const p = settings.pipelines.find(p => p.id === settings.activePipelineId);
        label.innerText = p ? p.name : 'Unknown';
    }
}
