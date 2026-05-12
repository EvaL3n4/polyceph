/**
 * Renders the HTML for a single tab.
 */
export function renderTab(step, index, isActive) {
    const label = step.label || `Step ${index + 1}`;
    return `
        <div class="polyceph-step-tab ${isActive ? 'active' : ''}" data-index="${index}" title="${label}">
            <span style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${label}</span>
        </div>
    `;
}

/**
 * Attaches drag-to-scroll and mousewheel events to the tab bar.
 */
export function bindTabScrollEvents(tabContainer) {
    if (!tabContainer) return;

    let isDown = false;
    let startX;
    let scrollLeft;

    tabContainer.addEventListener('mousedown', (e) => {
        isDown = true;
        tabContainer.classList.add('active');
        startX = e.pageX - tabContainer.offsetLeft;
        scrollLeft = tabContainer.scrollLeft;
    });

    tabContainer.addEventListener('mouseleave', () => {
        isDown = false;
    });

    tabContainer.addEventListener('mouseup', () => {
        isDown = false;
    });

    tabContainer.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - tabContainer.offsetLeft;
        const walk = (x - startX) * 2; // Scroll speed
        tabContainer.scrollLeft = scrollLeft - walk;
    });

    tabContainer.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
            e.preventDefault();
            tabContainer.scrollLeft += e.deltaY;
        }
    }, { passive: false });
}
