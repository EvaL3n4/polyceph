import { logger } from '../logger.js';
import { settings, getActivePipeline } from '../state.js';
import { generateId } from '../utils.js';
import { getWorldInfoForChat, getMainSystemPrompt } from '../compat-shared.js';
import { updateTypingIndicator } from './ui-utils.js';

/**
 * Initializes the execution context for a pipeline run.
 * @returns {Promise<Object>} The initialized context data.
 */
export async function initializePipelineContext(userInput, generateSwipesForBatchId) {
    const stContext = SillyTavern.getContext();
    const activePipeline = getActivePipeline();
    const pipelineName = activePipeline?.name || 'Default';

    const contextVault = {
        'user_input': userInput,
        'input': userInput
    };
    const batchId = generateSwipesForBatchId || 'batch_' + generateId();
    
    // Filter out typing indicator from chat for macro resolution to avoid '...' in history.
    // We also drop messages whose `mes` is exactly the streaming placeholder '...' — they
    // appear on a polyceph swipe that has not yet been streamed into (e.g. the previous
    // run was aborted, or a swipe placeholder was left in place). Without this guard the
    // placeholder leaks into {{cc_all_prompts}} / {{chat_history}} and the LLM sees a
    // stray '...' as the last assistant turn. The `polyceph_*` extra check keeps it
    // conservative: a real character line that happens to be the literal text "..." is
    // not affected.
    const cleanChat = stContext.chat.filter(m => {
        if (!m) return false;
        if (m.extra?.polyceph_typing && !m.is_user) return false;
        if (m.is_system) return false;
        if (m.mes?.trim().startsWith('/')) return false;
        // Streaming placeholder: only drop when the message carries a polyceph
        // management flag, so a real character line that happens to read "..."
        // is left untouched.
        if (m.extra) {
            const isPolycephManaged =
                m.extra.polyceph_typing ||
                m.extra.polyceph_streaming ||
                m.extra.polyceph_source;
            if (isPolycephManaged && (m.mes || '').trim() === '...') return false;
        }
        return true;
    });

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
            updateTypingIndicator();
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
