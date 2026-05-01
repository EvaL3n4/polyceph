import { settings, saveSettings } from '../../state.js';
import { SELECTORS, CLASSES, getEl, showEl, hideEl, updateText } from '../ui-shared.js';

/**
 * Updates the options in the chat pipeline selector based on current settings.
 */
export function updateChatSelectorOptions() {
    const label = getEl(SELECTORS.POLY_LABEL);
    if (!label) return;

    if (settings.activePipelineId === 'none') {
        updateText(label, 'None');
    } else {
        const p = settings.pipelines.find(p => p.id === settings.activePipelineId);
        updateText(label, p ? p.name : 'Unknown');
    }
}

/**
 * Populates and positions the pipeline dropdown menu.
 */
export function togglePipelineMenu(container, dropdown) {
    // Populate dropdown
    let html = `<div class="${CLASSES.DROPDOWN_ITEM} ${settings.activePipelineId === 'none' ? 'selected' : ''}" data-value="none">None</div>`;
    settings.pipelines.forEach(p => {
        const isSelected = p.id === settings.activePipelineId;
        html += `<div class="${CLASSES.DROPDOWN_ITEM} ${isSelected ? 'selected' : ''}" data-value="${p.id}">${p.name}</div>`;
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

    dropdown.classList.toggle(CLASSES.ACTIVE);

    // Bind items
    dropdown.querySelectorAll(`.${CLASSES.DROPDOWN_ITEM}`).forEach(item => {
        item.onclick = (e) => {
            const val = e.target.getAttribute('data-value');
            settings.activePipelineId = val;
            saveSettings();
            updateChatSelectorOptions();
            
            // Sync with other UI components
            const { updateSendButtonVisibility } = import('./action-buttons.js');
            updateSendButtonVisibility?.();

            dropdown.classList.remove(CLASSES.ACTIVE);

            // Sync with settings UI
            const settingsSelector = getEl(SELECTORS.SETTINGS_SELECTOR);
            if (settingsSelector) {
                settingsSelector.value = val;
                settingsSelector.dispatchEvent(new Event('change'));
            }
        };
    });
}

/**
 * Injects the pipeline selector components into the container.
 */
export function createPipelineSelector() {
    const container = document.createElement('div');
    container.id = SELECTORS.POLY_CONTAINER;
    container.className = 'polyceph-chat-pipeline-container';

    const label = document.createElement('span');
    label.id = SELECTORS.POLY_LABEL;
    label.className = 'polyceph-chat-pipeline-label';
    label.title = 'Polyceph Pipeline';

    const dropdown = document.createElement('div');
    dropdown.id = SELECTORS.POLY_DROPDOWN;
    dropdown.className = 'polyceph-custom-dropdown';

    const icon = document.createElement('span');
    icon.className = 'polyceph-chat-pipeline-icon';
    icon.innerText = '☍';

    const onToggle = (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePipelineMenu(container, dropdown);
    };

    icon.addEventListener('click', onToggle);
    label.addEventListener('click', onToggle);

    // Global click to close dropdown
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && !icon.contains(e.target) && !label.contains(e.target)) {
            dropdown.classList.remove(CLASSES.ACTIVE);
        }
    });

    container.appendChild(icon);
    container.appendChild(label);
    container.appendChild(dropdown);

    return container;
}
