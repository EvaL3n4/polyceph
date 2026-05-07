import { logger } from '../logger.js';
import { settings, availableProfiles } from '../state.js';
import { expandPrompt } from '../macros/macros.js';
import { getCurrentPresetName, applyPreset, restorePresetState, getCapturedPresetName } from '../compat-presets.js';
import { updateTypingIndicator } from './ui-utils.js';
import { parseOutputTags } from './parser.js';
import { generateQuietly } from './generator.js';

/**
 * Executes a single task, including prompt expansion, generation, and retry logic.
 */
export async function runTask(node, nodeIndex, stepIdx, totalSteps, contextVault, cleanChat, signal, options = {}) {
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
                // Give ST time to settle the new preset settings
                await new Promise(r => setTimeout(r, 300));
            } else {
                logger.error(`Failed to apply preset "${taskPreset}".`);
            }
        }
    } else {
        // If "Current" is selected, we should still ensure we are using the session-original preset
        // rather than a task-specific one from a previous step.
        const originalPreset = getCapturedPresetName();
        const currentPreset = getCurrentPresetName();

        if (originalPreset && originalPreset !== currentPreset) {
            logger.info(`Restoring session-original preset: "${originalPreset}" (was: "${currentPreset}")`);
            if (applyPreset(originalPreset)) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    // 2. Resolve Profile & API Info
    const prof = availableProfiles.find(p => p.id === node.profile);
    const profileDisplayName = node.profile === 'none' ? '(Template Only)' : (prof ? prof.name : (node.profile || 'Default'));

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

        // 4b. Build streaming options
        const streamingOptions = {
            streaming: node.streaming !== false,
            antiLoop: node.antiLoop !== false,
            loopThreshold: settings.loopDetectionThreshold || 3,
            onStream: null, // Can be set by orchestrator for character message streaming
            outputType: node.outputType || 'internal',
            allowTools: node.allowTools !== false,
            skipSuccessRecursion: !!node.skipSuccessRecursion,
            hideSuccessResponse: !!node.hideSuccessResponse,
        };

        // Allow orchestrator to inject a stream callback (for character message streaming)
        if (typeof options?.onStream === 'function') {
            streamingOptions.onStream = options.onStream;
        }

        // 5. Generation Loop (Retries)
        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
            if (signal.aborted) return null;

            try {
                const rawRes = await generateQuietly(node.profile, prompt, taskApi, signal, streamingOptions);
                lastRawResponse = rawRes;

                if (signal.aborted) return null;

                const isEmpty = !rawRes || rawRes.trim() === "" || rawRes === "(Generation returned empty)" || rawRes === "(Error during generation)";

                if (!isEmpty) {
                    parsedResult = parseOutputTags(rawRes, node.label || `Task ${taskIdIndx}`, profileDisplayName, node.persist && !node.isCharacter);
                    break;
                }

                if (attempt === maxAttempts) {
                    throw new Error(lastRawResponse || "Generation returned empty after all retries.");
                }
            } catch (e) {
                if (signal.aborted) throw e;

                // Loop detection: on last retry, return truncated text instead of failing
                if (e.message === 'Loop detected' && attempt === maxAttempts) {
                    logger.warn(`Task ${node.id}: loop detected on final attempt. Returning truncated output.`);
                    // The truncated text will be in the error's context — use what we have
                    if (lastRawResponse && lastRawResponse.trim()) {
                        parsedResult = parseOutputTags(lastRawResponse, node.label || `Task ${taskIdIndx}`, profileDisplayName, node.persist && !node.isCharacter);
                        break;
                    }
                    throw new Error('Loop detected: no usable output after all retries.');
                }

                if (e.message === 'Loop detected') {
                    logger.warn(`Task ${node.id} attempt ${attempt + 1}: loop detected. Retrying...`);
                    toastr.warning(`Loop detected. Retrying (${attempt + 1}/${maxAttempts})...`, 'Polyceph');
                } else {
                    lastRawResponse = e.message;
                    if (attempt === maxAttempts) {
                        throw e;
                    }
                    logger.warn(`Task ${node.id} attempt ${attempt + 1} failed: ${e.message}. Retrying...`);
                    toastr.warning(`Task failed. Retrying (${attempt + 1}/${maxAttempts})...`, 'Polyceph');
                }
            }

            const delayWait = settings.retryDelayMs !== undefined ? settings.retryDelayMs : 2000;
            await new Promise(r => setTimeout(r, delayWait));
        }

        if (!parsedResult) throw new Error("Task failed to produce a valid response.");

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
