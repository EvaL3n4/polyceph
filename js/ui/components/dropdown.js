import { logger } from '../../logger.js';

/**
 * Shows a custom multi-select dropdown relative to a trigger element.
 * @param {HTMLElement} trigger - The element to position the dropdown relative to.
 * @param {Object} options - Configuration options.
 * @param {string[]} options.items - Array of strings for the options.
 * @param {string[]} options.selectedItems - Array of currently selected strings.
 * @param {Function} options.onToggle - Callback function(item, isSelected, newSelectedList).
 * @param {string} options.className - Optional extra class for the dropdown.
 */
export function showMultiSelectDropdown(trigger, { items, selectedItems, onToggle, className = '' }) {
    // Remove any existing instances of this dropdown type
    const dropdownClass = `polyceph-multi-select-${className || 'generic'}`;
    const existing = document.querySelector(`.${dropdownClass}`);
    if (existing) existing.remove();

    const dropdown = document.createElement('div');
    dropdown.className = `polyceph-custom-dropdown active ${dropdownClass} ${className}`;
    
    const renderItems = () => {
        let html = '';
        items.forEach(item => {
            const isSelected = selectedItems.includes(item);
            html += `
                <div class="polyceph-dropdown-item ${isSelected ? 'selected' : ''}" data-value="${item}">
                    <i class="fa-solid ${isSelected ? 'fa-square-check' : 'fa-square'}" style="margin-right: 8px; opacity: 0.8;"></i>
                    <span>${item}</span>
                </div>
            `;
        });

        if (items.length === 0) {
            html = '<div class="polyceph-dropdown-item" style="opacity: 0.6; font-style: italic;">No items available</div>';
        }

        dropdown.innerHTML = html;

        // Re-bind items after re-render
        dropdown.querySelectorAll('.polyceph-dropdown-item').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                const val = el.getAttribute('data-value');
                if (!val) return;

                const isSelected = selectedItems.includes(val);
                if (isSelected) {
                    selectedItems = selectedItems.filter(i => i !== val);
                } else {
                    selectedItems.push(val);
                }

                if (typeof onToggle === 'function') {
                    onToggle(val, !isSelected, selectedItems);
                }

                // Re-render internally to update checkboxes
                renderItems();
            };
        });
    };

    const targetParent = document.getElementById('extensions_settings') || document.body;
    targetParent.appendChild(dropdown);
    renderItems();

    // Stop propagation on the dropdown itself to prevent SillyTavern 
    // from thinking we clicked outside the settings panel and closing the drawer.
    dropdown.addEventListener('click', (e) => e.stopPropagation());

    // Position dropdown
    const rect = trigger.getBoundingClientRect();
    const parentRect = targetParent.getBoundingClientRect();

    dropdown.style.position = 'absolute';
    dropdown.style.left = `${rect.left - parentRect.left}px`;
    dropdown.style.top = `${rect.bottom - parentRect.top + 5}px`;
    dropdown.style.minWidth = `${rect.width + 40}px`;
    dropdown.style.zIndex = '3000';

    // Global click to close
    const closeHandler = (e) => {
        if (!dropdown.contains(e.target) && !trigger.contains(e.target)) {
            dropdown.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    document.addEventListener('click', closeHandler);

    return dropdown;
}
