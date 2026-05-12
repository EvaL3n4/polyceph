import { logger } from '../logger.js';
import { settings, getActivePipeline } from '../state.js';
import { generateId } from '../utils.js';
import { getWorldInfoForChat, getMainSystemPrompt } from '../compat-shared.js';
import { updateTypingIndicator } from './ui-utils.js';

/**
 * Initializes the execution context for a pipeline run.
 * @returns {Promise<Object>} The initialized context data.
 */
export async function initializePipelineContext(userInput, generateSwipesForBatchId, options = {}) {
    const stContext = SillyTavern.getContext();
    const activePipeline = getActivePipeline();
    const pipelineName = activePipeline?.name || 'Default';

    const contextVault = {
        'user_input': userInput,
        'input': userInput
    };
    const batchId = generateSwipesForBatchId || 'batch_' + generateId();
    
    // Filter out typing indicator from chat for macro resolution to avoid '...' in history
    const cleanChat = options.mockCleanChat || stContext.chat.filter(m => m && !m.extra?.polyceph_typing && !m.is_system && !m.mes?.trim().startsWith('/'));

    // Fetch system prompt
    contextVault['system_prompt'] = getMainSystemPrompt();
    contextVault['polyceph_prompt'] = settings.polycephPrompt || '';

    let batchCharMessages = [];
    let batchBgMessages = [];
    let batchReasoningMsg = null;
    
    if (generateSwipesForBatchId) {
        const batchMsgs = stContext.chat.filter(m => m.extra?.polyceph_batch === generateSwipesForBatchId);
        batchBgMessages = batchMsgs.filter(m => m.extra?.polyceph_hidden);
        batchCharMessages = batchMsgs.filter(m => !m.extra?.polyceph_hidden && m.name !== 'Polyceph Reasoning');
        batchReasoningMsg = batchMsgs.find(m => m.name === 'Polyceph Reasoning') || null;
    }

    logger.debug('Pipeline context initialized. Clean chat size:', cleanChat.length);

    // Cleanup 'waiting' task if it exists from the emulation phase
    const cleanTypingIdx = stContext.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
    const typingMsg = cleanTypingIdx !== -1 ? stContext.chat[cleanTypingIdx] : null;
    if (typingMsg && typingMsg.extra && typingMsg.extra.polyceph_active_tasks) {
        const hasWaiting = typingMsg.extra.polyceph_active_tasks.some(t => t.id === 'waiting');
        if (hasWaiting) {
            typingMsg.extra.polyceph_active_tasks = typingMsg.extra.polyceph_active_tasks.filter(t => t.id !== 'waiting');
            if (!options.skipPersistence) updateTypingIndicator();
        }
    }

    return {
        stContext,
        activePipeline,
        pipelineName,
        contextVault,
        batchId,
        cleanChat,
        batchData: {
            batchId,
            batchCharMessages,
            batchBgMessages,
            batchReasoningMsg,
            generateSwipesForBatchId
        }
    };
}
