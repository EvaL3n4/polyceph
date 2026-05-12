import { logger } from '../logger.js';
import { executePipelineSteps } from './orchestrator.js';
import { captureSessionState, restoreSessionState } from './state-manager.js';

let currentScannerAbortController = null;

export function isScanActive() {
    return !!currentScannerAbortController;
}

export function stopScan() {
    if (currentScannerAbortController) {
        logger.info('Scan STOP requested.');
        currentScannerAbortController.abort();
        
        // Also abort any active ST generations (API calls)
        const context = SillyTavern.getContext();
        if (typeof context.abortGeneration === 'function') {
            context.abortGeneration();
        }
        toastr.warning('Stopping scan...', 'Polyceph');
    }
}

/**
 * Runs a pipeline across a range of chat messages in batches, without generating chat messages.
 */
export async function runScan(rangeStart, rangeEnd, batchSize, offset, pipeline, onProgress) {
    if (currentScannerAbortController) currentScannerAbortController.abort();
    currentScannerAbortController = new AbortController();
    const signal = currentScannerAbortController.signal;

    const stContext = SillyTavern.getContext();
    const chatLen = stContext.chat.length;

    rangeStart = Math.max(0, parseInt(rangeStart) || 0);
    rangeEnd = Math.min(chatLen, parseInt(rangeEnd) || chatLen);
    batchSize = Math.max(1, parseInt(batchSize) || 1);
    offset = parseInt(offset) || 0;

    const stepSize = batchSize + offset;
    if (stepSize < 1) {
        toastr.error('Batch size + offset must be at least 1 to prevent infinite loops.', 'Polyceph Scan');
        currentScannerAbortController = null;
        if (typeof onProgress === 'function') onProgress({ status: 'error', error: 'Invalid step size' });
        return;
    }

    if (rangeStart >= rangeEnd) {
        toastr.info('Scan range is empty.', 'Polyceph Scan');
        currentScannerAbortController = null;
        if (typeof onProgress === 'function') onProgress({ status: 'completed' });
        return;
    }

    // Calculate total batches
    const batches = [];
    let currentIndex = rangeStart;
    while (currentIndex < rangeEnd) {
        let batchEnd = Math.min(currentIndex + batchSize, rangeEnd);
        batches.push({ start: currentIndex, end: batchEnd });
        currentIndex += stepSize;
    }

    const totalBatches = batches.length;
    
    // Set active pipeline locally to ensure context.js uses it
    const { settings } = await import('../state.js');
    const prevPipelineId = settings.activePipelineId;
    settings.activePipelineId = pipeline.id;
    
    captureSessionState();

    try {
        for (let i = 0; i < totalBatches; i++) {
            if (signal.aborted) break;

            const batch = batches[i];
            const batchIdx = i + 1;
            
            // The slice is exclusive of the end index.
            // We strip system messages out just like cleanChat does natively.
            const mockCleanChat = stContext.chat.slice(batch.start, batch.end).filter(m => m && !m.is_system && !m.mes?.trim().startsWith('/'));

            if (typeof onProgress === 'function') {
                onProgress({
                    status: 'running',
                    batchIndex: batchIdx,
                    totalBatches,
                    messageStart: batch.start,
                    messageEnd: batch.end - 1,
                    rangeStart,
                    rangeEnd
                });
            }

            logger.info(`[Scan] Processing batch ${batchIdx}/${totalBatches} (Msgs ${batch.start}-${batch.end - 1})`);

            const options = {
                skipPersistence: true,
                mockCleanChat: mockCleanChat
            };

            // executePipelineSteps throws if a task fails and continueOnFailure is false.
            await executePipelineSteps('', null, signal, options);
            
            if (signal.aborted) break;
            
            // Brief pause to not lock up UI completely if there are many fast tools
            await new Promise(r => setTimeout(r, 100));
        }

        if (signal.aborted) {
            if (typeof onProgress === 'function') onProgress({ status: 'aborted' });
        } else {
            if (typeof onProgress === 'function') onProgress({ status: 'completed' });
            toastr.success('Scan completed.', 'Polyceph');
        }
    } catch (e) {
        if (e.message === 'Aborted' || e.name === 'AbortError') {
            logger.info('Scan aborted by user.');
            if (typeof onProgress === 'function') onProgress({ status: 'aborted' });
        } else {
            logger.error('Scan Error', e);
            toastr.error('Scan stopped due to an error: ' + e.message, 'Polyceph');
            if (typeof onProgress === 'function') onProgress({ status: 'error', error: e.message });
        }
    } finally {
        await restoreSessionState();
        settings.activePipelineId = prevPipelineId;
        currentScannerAbortController = null;
    }
}
