import { logger } from '../logger.js';
import { MODULE_NAME, generationMutexEvents } from '../constants.js';
import { settings } from '../state.js';
import { ensureChatSaved } from '../compat-shared.js';
import { forceHideStopButton } from './ui-utils.js';

/**
 * Executes the final teardown sequence for a pipeline run.
 * This function orchestrates the "Event Storm" required to trick ST and other
 * extensions into correctly acknowledging the new message.
 */
export async function finalizePipelineTeardown(isEmergency = false) {
    const stContext = SillyTavern.getContext();
    if (!stContext.eventSource) {
        logger.warn('Teardown: stContext.eventSource missing. Skipping emulation.');
        return;
    }

    logger.debug(`Teardown: Initiating cleanup (Emergency: ${isEmergency}).`);

    // 1. Initial UI cleanup
    forceHideStopButton();

    // 2. Ensure state is committed to disk (unless emergency/abort)
    if (!isEmergency) {
        await ensureChatSaved();
    }

    // 3. Small pause to allow ST background tasks to settle
    await new Promise(resolve => setTimeout(resolve, 200));

    const lastMessageIdx = stContext.chat.length - 1;
    const isPolycephMsg = stContext.chat[lastMessageIdx]?.extra?.polyceph_source === 'polyceph';

    // Always release the mutex if we're here
    const releaseMutex = async () => {
        logger.debug('Teardown: Releasing mutex for extension processing.');
        await stContext.eventSource.emit(generationMutexEvents.MUTEX_RELEASED, { extension_name: MODULE_NAME });
    };

    if (settings.emulateCoreEvents && stContext.eventTypes) {
        if (isPolycephMsg && !isEmergency) {
            logger.debug('Teardown: Initiating full event emulation sequence.');
            
            // Re-hide button immediately before events
            forceHideStopButton();

            // A. Release Mutex
            await releaseMutex();

            // B. Core Message Events
            await stContext.eventSource.emit(stContext.eventTypes.MESSAGE_RECEIVED, lastMessageIdx);
            await stContext.eventSource.emit(stContext.eventTypes.CHARACTER_MESSAGE_RENDERED, lastMessageIdx);

            // C. Settle period
            await new Promise(r => setTimeout(r, 200));

            // D. Generation Stop Events
            await stContext.eventSource.emit(stContext.eventTypes.GENERATION_STOPPED, 'normal', { automatic_trigger: true }, false);
            if (stContext.eventTypes.CHARACTER_GENERATION_STOPPED) {
                await stContext.eventSource.emit(stContext.eventTypes.CHARACTER_GENERATION_STOPPED, lastMessageIdx);
            }
            await stContext.eventSource.emit(stContext.eventTypes.GENERATION_AFTER_DATA, 'normal', { automatic_trigger: true }, false);
        } else {
            logger.debug('Teardown: Simple release sequence.');
            forceHideStopButton();
            await releaseMutex();
            await stContext.eventSource.emit(stContext.eventTypes.GENERATION_STOPPED, 'normal', { automatic_trigger: true }, false);
        }
    } else {
        // No emulation: Just release and signal end
        logger.debug('Teardown: Emulation disabled or emergency. Releasing mutex.');
        forceHideStopButton();
        await releaseMutex();
        await stContext.eventSource.emit(stContext.eventTypes.GENERATION_STOPPED, 'normal', { automatic_trigger: true }, false);
    }

    // F. Final Safety Reset
    setTimeout(() => {
        forceHideStopButton();
        stContext.eventSource.emit('polyceph-pipeline-ended');
    }, 100);
}
