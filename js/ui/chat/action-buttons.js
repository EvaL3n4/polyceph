import { settings } from '../../state.js';
import { isPipelineActive, stopPipeline, isScanActive, stopScan } from '../../engine.js';
import { SELECTORS, getEl, showEl, hideEl, disableEl, enableEl } from '../ui-shared.js';

/**
 * Updates the visibility and state of the custom send/stop buttons and standard ST buttons.
 */
export function updateSendButtonVisibility() {
    const polySendBut = getEl(SELECTORS.POLY_SEND_BTN);
    const polyStopBut = getEl(SELECTORS.POLY_STOP_BTN);
    const scanStopBut = getEl('polyceph_scan_stop_bar_btn');
    const stSendBut = getEl(SELECTORS.ST_SEND_BTN);
    const container = getEl(SELECTORS.POLY_CONTAINER);

    if (!polySendBut || !polyStopBut || !stSendBut) return;

    const isActive = settings.activePipelineId !== 'none';
    const isIntercept = settings.interceptSend !== false;
    const isRunning = isPipelineActive();
    const isScanning = isScanActive();

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
        if (isScanning) {
            hideEl(polyStopBut);
            hideEl(polySendBut);
            if (stSendBut) hideEl(stSendBut);
            if (scanStopBut) showEl(scanStopBut);
        } else if (isRunning) {
            showEl(polyStopBut);
            hideEl(polySendBut);
            if (stSendBut) hideEl(stSendBut);
            if (scanStopBut) hideEl(scanStopBut);
        } else {
            hideEl(polyStopBut);
            if (scanStopBut) hideEl(scanStopBut);
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
        if (scanStopBut) hideEl(scanStopBut);
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

/**
 * Creates the custom Polyceph scan stop button.
 */
export function createScanStopButton() {
    const btn = document.createElement('div');
    btn.id = 'polyceph_scan_stop_bar_btn';
    btn.className = 'polyceph-stop-button interactable';
    btn.title = 'Stop Polyceph Scan';
    btn.style.display = 'none';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-circle-stop';
    btn.appendChild(icon);

    const overlay = document.createElement('span');
    overlay.className = 'polyceph-send-button-overlay';
    overlay.innerText = '☍ Scan';
    overlay.style.fontSize = '0.5em';
    btn.appendChild(overlay);

    btn.addEventListener('click', () => stopScan());

    return btn;
}
