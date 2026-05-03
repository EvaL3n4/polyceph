import { logger } from '../logger.js';
import { postMessageToChat, getActiveCharacterInfo, ensureChatSaved } from '../compat-shared.js';

/**
 * Handles persistence of hidden background messages.
 */
export async function handleBackgroundOutput(bg, bgIndex, batchData, api, model) {
    const stContext = SillyTavern.getContext();
    const { batchId, batchBgMessages, generateSwipesForBatchId } = batchData;

    if (generateSwipesForBatchId && bgIndex < batchBgMessages.length) {
        // Update existing background message as a swipe
        const targetBg = batchBgMessages[bgIndex];
        let actualBgIdx = stContext.chat.indexOf(targetBg);
        if (actualBgIdx === -1) {
            actualBgIdx = stContext.chat.findIndex(m => m.extra?.polyceph_batch === batchId && m.extra?.polyceph_hidden && m.mes === targetBg.mes);
        }

        // Ensure swipes array exists
        if (!Array.isArray(targetBg.swipes)) {
            targetBg.swipes = [targetBg.mes];
            targetBg.swipe_info = [{ extra: { ...(targetBg.extra || {}) } }];
            targetBg.swipe_id = 0;
        }

        targetBg.swipes.push(bg);
        targetBg.swipe_id = targetBg.swipes.length - 1;
        targetBg.mes = bg;

        const bgExtra = {
            polyceph_source: 'polyceph',
            polyceph_hidden: true,
            polyceph_batch: batchId,
            api: api,
            model: model
        };
        targetBg.swipe_info.push({ extra: bgExtra });
        targetBg.extra = { ...bgExtra };

        if (actualBgIdx !== -1 && typeof stContext.updateMessageBlock === 'function') {
            stContext.updateMessageBlock(actualBgIdx, targetBg);
        }

        if (typeof stContext.swipe?.refresh === 'function') stContext.swipe.refresh(true);
        await ensureChatSaved();
    } else {
        // New background
        postMessageToChat({
            content: bg,
            name: 'Background',
            extra: { polyceph_source: 'polyceph', polyceph_hidden: true, polyceph_batch: batchId },
            save: true,
            api: api,
            model: model,
        });
    }
}

/**
 * Handles persistence of character messages, including thoughts and swipes.
 */
export async function handleCharacterOutput(content, thoughts, charIndex, node, batchData, api, model, userInput, pipelineName) {
    const stContext = SillyTavern.getContext();
    const { batchId, batchCharMessages, generateSwipesForBatchId } = batchData;
    const { name: charName, avatarUrl: avatarStr } = getActiveCharacterInfo();

    const extraData = {
        polyceph_source: 'polyceph',
        polyceph_batch: batchId,
        polyceph_input: userInput,
        polyceph_task_id: node.id,
        polyceph_pipeline: pipelineName,
        api: api,
        model: model
    };
    if (thoughts && thoughts.length > 0) {
        extraData.polyceph_thoughts = thoughts;
    }

    if (generateSwipesForBatchId && charIndex < batchCharMessages.length) {
        const targetMessage = batchCharMessages[charIndex];
        let actualMesId = stContext.chat.indexOf(targetMessage);
        if (actualMesId === -1) {
            actualMesId = stContext.chat.findIndex(m => m.extra?.polyceph_task_id === node.id && m.extra?.polyceph_batch === batchId);
        }

        if (!Array.isArray(targetMessage.swipes)) {
            targetMessage.swipes = [targetMessage.mes];
            targetMessage.swipe_info = [{ extra: { ...(targetMessage.extra || {}) } }];
            targetMessage.swipe_id = 0;
        }

        targetMessage.swipes.push(content);
        targetMessage.swipe_id = targetMessage.swipes.length - 1;
        targetMessage.extra = { ...extraData };
        targetMessage.swipe_info.push({ extra: { ...targetMessage.extra } });
        targetMessage.mes = content;

        if (actualMesId !== -1 && typeof stContext.updateMessageBlock === 'function') {
            stContext.updateMessageBlock(actualMesId, targetMessage);
            await ensureChatSaved();
            if (typeof stContext.swipe?.refresh === 'function') stContext.swipe.refresh(true);
        }
    } else {
        postMessageToChat({
            content: content,
            name: charName,
            forceAvatar: avatarStr,
            extra: extraData,
            api: api,
            model: model,
            silent: true,
        });
    }
}

/**
 * Persists any leftover thoughts into a "Polyceph Reasoning" message.
 */
export async function persistReasoningMessage(thoughts, batchData, userInput) {
    const stContext = SillyTavern.getContext();
    const { batchId, batchReasoningMsg, generateSwipesForBatchId } = batchData;

    if (generateSwipesForBatchId && batchReasoningMsg) {
        const rIdx = stContext.chat.indexOf(batchReasoningMsg);
        if (!Array.isArray(batchReasoningMsg.swipes)) {
            batchReasoningMsg.swipes = [batchReasoningMsg.mes];
            batchReasoningMsg.swipe_info = [{}];
            batchReasoningMsg.swipe_id = 0;
        }
        batchReasoningMsg.swipes.push('');
        batchReasoningMsg.swipe_id = batchReasoningMsg.swipes.length - 1;
        batchReasoningMsg.mes = '';
        if (!batchReasoningMsg.extra) batchReasoningMsg.extra = {};
        batchReasoningMsg.extra.polyceph_thoughts = thoughts;
        batchReasoningMsg.swipe_info.push({ extra: { polyceph_thoughts: thoughts } });

        if (rIdx !== -1 && typeof stContext.updateMessageBlock === 'function') {
            stContext.updateMessageBlock(rIdx, batchReasoningMsg);
            await ensureChatSaved();
        }
    } else {
        postMessageToChat({
            content: '',
            name: 'Polyceph Reasoning',
            extra: { polyceph_source: 'polyceph', polyceph_batch: batchId, polyceph_input: userInput, polyceph_thoughts: thoughts },
            api: stContext.mainApi,
            model: stContext.model,
        });
    }
}
