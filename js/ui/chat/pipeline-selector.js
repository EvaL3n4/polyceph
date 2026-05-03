import { settings, saveSettings } from '../../state.js';
import { SELECTORS, CLASSES, getEl, showEl, hideEl, updateText } from '../ui-shared.js';
import { logger } from '../../logger.js';

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

    if (dropdown.classList.contains(CLASSES.ACTIVE)) {
        dropdown.classList.remove(CLASSES.ACTIVE);
        dropdown.style.display = 'none';
        return;
    }

    // Position dropdown relative to icon/container
    const rect = container.getBoundingClientRect();

    const dropdownWidth = 220;

    // Get mobile-accurate viewport dimensions
    const viewport = window.visualViewport;
    const vWidth = viewport ? viewport.width : window.innerWidth;
    const vHeight = viewport ? viewport.height : window.innerHeight;
    const vLeft = viewport ? viewport.offsetLeft : 0;
    const vTop = viewport ? viewport.offsetTop : 0;

    // Align right edge of dropdown with right edge of icon
    // Added a small nudge to align better visually above the icon
    let left = rect.right - dropdownWidth + 50;

    // Safety clamp within visual viewport
    left = Math.max(vLeft + 10, Math.min(left, vLeft + vWidth - dropdownWidth - 10));

    // Calculate bottom relative to the body's actual height
    const bodyHeight = document.body.offsetHeight;
    const bottomOffset = bodyHeight - rect.top + 5;

    logger.debug('Selector Placement (Body Absolute):', {
        rect: { top: rect.top, left: rect.left, right: rect.right },
        calculated: { left, bottom: bottomOffset }
    });

    // Final placement using Body-Relative Absolute Positioning
    dropdown.style.display = 'flex';
    dropdown.style.visibility = 'visible';
    dropdown.style.position = 'absolute';
    dropdown.style.left = `${left}px`;
    dropdown.style.bottom = `${bottomOffset}px`;
    dropdown.style.top = 'auto';
    dropdown.style.right = 'auto';
    dropdown.style.zIndex = '2147483647';
    dropdown.style.transform = 'none';
    dropdown.style.pointerEvents = 'all';

    if (dropdown.parentElement !== document.body) {
        document.body.appendChild(dropdown);
    }

    dropdown.classList.add(CLASSES.ACTIVE);

    // Bind items
    dropdown.querySelectorAll(`.${CLASSES.DROPDOWN_ITEM}`).forEach(item => {
        item.onclick = (e) => {
            const val = e.currentTarget.getAttribute('data-value');

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

    // Rely on standard click events (auto-emulated on mobile) to prevent listener conflicts
    icon.addEventListener('click', onToggle);
    label.addEventListener('click', onToggle);

    // Global click to close dropdown
    const closeDropdown = (e) => {
        if (!dropdown.contains(e.target) && !icon.contains(e.target) && !label.contains(e.target)) {
            dropdown.classList.remove(CLASSES.ACTIVE);
        }
    };
    document.addEventListener('click', closeDropdown);



    container.appendChild(icon);
    container.appendChild(label);
    container.appendChild(dropdown);

    return container;
}
