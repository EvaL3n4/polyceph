import { MODULE_NAME, generationMutexEvents } from './constants.js';
import { settings, switchProfile, getActivePipeline, availableProfiles, saveSettings, clearProfileState } from './state.js';
import { generateId, waitForApiReady } from './utils.js';
import { expandPrompt } from './macros/macros.js';
import { getMaxContextTokens, getMaxResponseTokens, countTokens, generateViaApi, postMessageToChat, ensureChatSaved, getWorldInfoForChat, getActiveCharacterInfo, getMainSystemPrompt } from './compat-shared.js';
import { clearPresetState, applyPreset, getCurrentPresetName } from './compat-presets.js';
import { logger } from './logger.js';

// Sub-modules
import { forceHideStopButton, startTypingIndicator, removeTypingIndicator, updateTypingIndicator, clearOrphanedIndicators } from './engine/ui-utils.js';
import { parseOutputTags, parsePromptToMessages } from './engine/parser.js';
import { captureSessionState, restoreSessionState } from './engine/state-manager.js';
import { finalizePipelineTeardown } from './engine/teardown.js';
import { executePipelineSteps } from './engine/orchestrator.js';
import { generateQuietly } from './engine/generator.js';

// Re-exports for backward compatibility with index.js and other files
export { forceHideStopButton, startTypingIndicator, removeTypingIndicator, updateTypingIndicator, clearOrphanedIndicators };
export { parseOutputTags, parsePromptToMessages };
export { captureSessionState, restoreSessionState };
export { finalizePipelineTeardown };
export { executePipelineSteps, generateQuietly };

let currentPipelineAbortController = null;
let currentMutexHolder = null;

// Listen for mutex events globally to track state
function initMutexTracker() {
    const context = SillyTavern.getContext();
    if (context.eventSource) {
        context.eventSource.on(generationMutexEvents.MUTEX_CAPTURED, (data) => {
            currentMutexHolder = data?.extension_name || 'unknown';
        });
        context.eventSource.on(generationMutexEvents.MUTEX_RELEASED, () => {
            currentMutexHolder = null;
        });
    }
}
initMutexTracker();

export function isPipelineActive() {
    return !!currentPipelineAbortController;
}

export function stopPipeline() {
    if (currentPipelineAbortController) {
        logger.info('Pipeline STOP requested.');
        currentPipelineAbortController.abort();

        const context = SillyTavern.getContext();

        // Tell SillyTavern to abort any active background generations
        if (typeof context.abortGeneration === 'function') {
            context.abortGeneration();
        }

        // Mark indicator
        const typingIdx = context.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
        if (typingIdx !== -1) {
            const userMsg = context.chat[typingIdx];
            userMsg.extra.polyceph_active_tasks = [];
            updateTypingIndicator();
        }

        toastr.warning('Stopping pipeline...', 'Polyceph');
    }
}


export async function startPipeline(text, generateSwipesForBatchId, triggeringUserMesId = -1) {
    try {
        logger.info('Starting pipeline for text:', text.substring(0, 50) + '...');
        await runPipeline(text, generateSwipesForBatchId, triggeringUserMesId);
    } catch (err) {
        logger.error('Error starting pipeline:', err);
    }
}

export async function runPipeline(userInput, generateSwipesForBatchId, triggeringUserMesId = -1) {
    if (currentPipelineAbortController) currentPipelineAbortController.abort();
    currentPipelineAbortController = new AbortController();
    const signal = currentPipelineAbortController.signal;

    const stContext = SillyTavern.getContext();
    if (stContext.eventSource) {
        stContext.eventSource.emit('polyceph-pipeline-started');
    }

    // 0. Initial UI & Emulation State
    if (triggeringUserMesId !== -1) {
        const userMsg = stContext.chat[triggeringUserMesId];
        if (userMsg) {
            if (!userMsg.extra) userMsg.extra = {};
            userMsg.extra.polyceph_typing = true;
            userMsg.extra.polyceph_active_tasks = [];
            updateTypingIndicator();
            if (typeof stContext.updateMessageBlock === 'function') {
                stContext.updateMessageBlock(triggeringUserMesId, userMsg);
            }
        }
    } else {
        await startTypingIndicator();
    }
    logger.debug('Typing indicator started.');

    try {
        // Core Event Emulation (Start)
        // We do this FIRST so extensions like Tracker Enhanced use the USER'S stable profile
        if (settings.emulateCoreEvents && stContext.eventSource && stContext.eventTypes) {
            const emulateOptions = {
                automatic_trigger: true,
                force_chid: stContext.characterId,
                signal: signal
            };

            logger.debug('Emitting core generation events (Cooperative mode)...');

            await stContext.eventSource.emit(stContext.eventTypes.GENERATION_STARTED, 'normal', emulateOptions, false);

            // Give extensions a moment to process the "Started" event
            await new Promise(r => setTimeout(r, 100));

            // Release the early mutex lock from index.js so pre-generation extensions can act
            await stContext.eventSource.emit(generationMutexEvents.MUTEX_RELEASED, { extension_name: MODULE_NAME });

            // Add custom typing status to the Polyceph typing indicator
            const typingIdx = stContext.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
            const typingMsg = typingIdx !== -1 ? stContext.chat[typingIdx] : null;
            if (typingMsg) {
                if (!typingMsg.extra.polyceph_active_tasks) typingMsg.extra.polyceph_active_tasks = [];
                typingMsg.extra.polyceph_active_tasks.push({
                    id: 'waiting',
                    step: 1,
                    totalSteps: 1,
                    label: 'Waiting for Extensions...',
                    profile: 'System'
                });
                updateTypingIndicator();
            }

            // Small delay to ensure extension-internal state is synchronized
            await new Promise(r => setTimeout(r, 50));

            await stContext.eventSource.emit(stContext.eventTypes.GENERATION_AFTER_COMMANDS, 'normal', emulateOptions, false);

            // Ensure all extension metadata (like Tracker-Enhanced temp trackers) is synced to the server 
            await ensureChatSaved();

            // Recapture mutex AFTER core events for the actual pipeline execution.
            logger.debug('Recapturing mutex for pipeline execution...');
            await stContext.eventSource.emit(generationMutexEvents.MUTEX_CAPTURED, { extension_name: MODULE_NAME });

            logger.debug(`Mutex recaptured. signal.aborted = ${signal.aborted}`);
        }

        // 1. Capture current state for restoration
        captureSessionState();

        // 2. Execute pipeline steps
        logger.debug(`Calling executePipelineSteps (signal.aborted = ${signal.aborted})...`);
        await executePipelineSteps(userInput, generateSwipesForBatchId, signal);
        logger.debug('executePipelineSteps returned.');

    } catch (e) {
        if (e.message === 'Aborted' || e.name === 'AbortError') {
            logger.info('Pipeline aborted by user.');
        } else {
            toastr.error('Pipeline execution encountered an error.', 'Polyceph');
            logger.error('Pipeline Error', e);
        }
        if (currentPipelineAbortController) {
            currentPipelineAbortController.abort();
        }
    } finally {
        // 1. Immediate UI Cleanup
        await removeTypingIndicator();
        forceHideStopButton();
        
        // Give UI a moment to settle
        await new Promise(r => setTimeout(r, 100));

        // 2. Restore the user's original session state
        await restoreSessionState();
        
        currentPipelineAbortController = null;

        // 3. Final Event Emulation & Mutex Release
        await finalizePipelineTeardown();
    }
}
