import { settings } from '../../state.js';
import { isPipelineActive, stopPipeline } from '../../engine.js';
import { SELECTORS, getEl, showEl, hideEl, disableEl, enableEl } from '../ui-shared.js';

/**
 * Updates the visibility and state of the custom send/stop buttons and standard ST buttons.
 */
export function updateSendButtonVisibility() {
    const polySendBut = getEl(SELECTORS.POLY_SEND_BTN);
    const polyStopBut = getEl(SELECTORS.POLY_STOP_BTN);
    const stSendBut = getEl(SELECTORS.ST_SEND_BTN);
    const container = getEl(SELECTORS.POLY_CONTAINER);

    if (!polySendBut || !polyStopBut || !stSendBut) return;

    const isActive = settings.activePipelineId !== 'none';
    const isIntercept = settings.interceptSend !== false;
    const isRunning = isPipelineActive();

    // Pipeline Selector visibility
    if (container) {
        if (isActive && settings.showPipelineSelector !== false) {
            showEl(container);
            const icon = container.querySelector('.polyceph-chat-pipeline-icon');
            if (icon) icon.style.display = (settings.showPipelineIcon !== false) ? 'flex' : 'none';

            const label = getEl(SELECTORS.POLY_LABEL);
            if (label) {
                if (settings.compactSelectorMode) hideEl(label);
                else showEl(label, 'inline-block');
            }
        } else {
            hideEl(container);
        }
    }

    if (isActive) {
        if (isRunning) {
            showEl(polyStopBut);
            if (isIntercept) {
                showEl(polySendBut);
                disableEl(polySendBut);
            } else {
                hideEl(polySendBut);
                if (stSendBut) disableEl(stSendBut);
            }
        } else {
            hideEl(polyStopBut);
            enableEl(polySendBut);
            if (stSendBut) enableEl(stSendBut);

            if (isIntercept) {
                hideEl(polySendBut);
                stSendBut.style.display = '';
            } else {
                showEl(polySendBut);
                stSendBut.style.display = '';
            }
        }
    } else {
        hideEl(polySendBut);
        hideEl(polyStopBut);
        stSendBut.style.display = '';
    }
}

/**
 * Creates the custom Polyceph send button.
 */
export function createSendButton(handler) {
    const btn = document.createElement('div');
    btn.id = SELECTORS.POLY_SEND_BTN;
    btn.className = 'polyceph-send-button interactable';
    btn.title = 'Send via Polyceph';
    btn.style.display = 'none';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-paper-plane';
    btn.appendChild(icon);

    const overlay = document.createElement('span');
    overlay.className = 'polyceph-send-button-overlay';
    overlay.innerText = '☍';
    btn.appendChild(overlay);

    if (handler) {
        btn.addEventListener('click', (e) => handler(e));
    }

    return btn;
}

/**
 * Creates the custom Polyceph stop button.
 */
export function createStopButton() {
    const btn = document.createElement('div');
    btn.id = SELECTORS.POLY_STOP_BTN;
    btn.className = 'polyceph-stop-button interactable';
    btn.title = 'Stop Polyceph Pipeline';
    btn.style.display = 'none';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-circle-stop';
    btn.appendChild(icon);

    const overlay = document.createElement('span');
    overlay.className = 'polyceph-send-button-overlay';
    overlay.innerText = '☍';
    btn.appendChild(overlay);

    btn.addEventListener('click', () => stopPipeline());

    return btn;
}
