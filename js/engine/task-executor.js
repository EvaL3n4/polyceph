import { logger } from '../logger.js';
import { settings, availableProfiles } from '../state.js';
import { expandPrompt } from '../macros/macros.js';
import { getCurrentPresetName, applyPreset, restorePresetState } from '../compat-presets.js';
import { updateTypingIndicator } from './ui-utils.js';
import { parseOutputTags } from './parser.js';
import { generateQuietly } from './generator.js';

/**
 * Executes a single task, including prompt expansion, generation, and retry logic.
 */
export async function runTask(node, nodeIndex, stepIdx, totalSteps, contextVault, cleanChat, signal) {
    const stContext = SillyTavern.getContext();
    const taskIdIndx = nodeIndex + 1;
    
    // 1. Preset Management
    const taskPreset = node.preset || 'Current';
    if (taskPreset !== 'Current') {
        const currentPreset = getCurrentPresetName();
        if (currentPreset !== taskPreset) {
            logger.info(`Applying task preset: "${taskPreset}" (was: "${currentPreset}")`);
            const switched = applyPreset(taskPreset);
            if (switched) {
                await new Promise(r => setTimeout(r, 300));
            } else {
                logger.error(`Failed to apply preset "${taskPreset}".`);
            }
        }
    } else {
        restorePresetState();
    }

    // 2. Resolve Profile & API Info
    const prof = availableProfiles.find(p => p.id === node.profile);
    const profileDisplayName = prof ? prof.name : (node.profile || 'Default');

    let taskApi = '';
    let taskModel = '';
    if (node.profile && node.profile !== 'current' && node.profile !== 'none') {
        if (prof) {
            taskApi = prof.api;
            taskModel = prof.model;
        }
    } else {
        taskApi = stContext.mainApi;
        taskModel = (typeof stContext.getGeneratingModel === 'function')
            ? stContext.getGeneratingModel()
            : (stContext.chatCompletionSettings?.openai_model || '');
    }

    // 3. Update Progress Metadata
    const typingIdx = stContext.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
    if (typingIdx !== -1) {
        const typingMsg = stContext.chat[typingIdx];
        if (!typingMsg.extra.polyceph_active_tasks) typingMsg.extra.polyceph_active_tasks = [];

        const taskMetadata = {
            id: node.id,
            label: node.label || `Task ${taskIdIndx}`,
            profile: profileDisplayName,
            status: 'generating',
            step: stepIdx,
            totalSteps: totalSteps
        };
        typingMsg.extra.polyceph_active_tasks.push(taskMetadata);
        updateTypingIndicator();
    }

    logger.debug(`Task Start: "${node.label || node.id}" (Profile: ${profileDisplayName}, API: ${taskApi})`);

    try {
        // 4. Prompt Expansion
        const prompt = await expandPrompt(node.template || '', settings, contextVault, cleanChat, stContext);
        
        if (signal.aborted) return null;

        let lastRawResponse = null;
        let parsedResult = null;
        const maxAttempts = (settings.maxRetries !== undefined) ? settings.maxRetries : 0;

        // 5. Generation Loop (Retries)
        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
            if (signal.aborted) return null;
            
            const rawRes = await generateQuietly(node.profile, prompt, taskApi, signal);
            lastRawResponse = rawRes;
            
            if (signal.aborted) return null;

            const isEmpty = !rawRes || rawRes.trim() === "" || rawRes === "(Generation returned empty)" || rawRes === "(Error during generation)";

            if (!isEmpty) {
                parsedResult = parseOutputTags(rawRes, node.label || `Task ${taskIdIndx}`, profileDisplayName, node.persist && !node.isCharacter);
                break; 
            }

            if (attempt < maxAttempts) {
                toastr.warning(`Task failed or returned empty. Retrying (${attempt + 1}/${maxAttempts})...`, 'Polyceph');
                const delayWait = settings.retryDelayMs !== undefined ? settings.retryDelayMs : 2000;
                await new Promise(r => setTimeout(r, delayWait));
            }
        }

        return {
            node,
            nodeIndex,
            taskIdIndx,
            taskApi,
            taskModel,
            profileDisplayName,
            rawResponse: lastRawResponse,
            parsedResult
        };

    } catch (e) {
        logger.error(`Task execution error: ${node.id}`, e);
        return {
            node,
            nodeIndex,
            taskIdIndx,
            error: e.message
        };
    } finally {
        // Cleanup metadata
        const typingIdxFin = stContext.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
        if (typingIdxFin !== -1) {
            const typingMsg = stContext.chat[typingIdxFin];
            if (typingMsg.extra.polyceph_active_tasks) {
                typingMsg.extra.polyceph_active_tasks = typingMsg.extra.polyceph_active_tasks.filter(t => t.id !== node.id);
                updateTypingIndicator();
            }
        }
    }
}
