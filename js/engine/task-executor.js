import { logger } from '../logger.js';
import { settings, availableProfiles } from '../state.js';
import { expandPrompt } from '../macros/macros.js';
import { getCurrentPresetName, applyPreset, restorePresetState, getCapturedPresetName } from '../compat-presets.js';
import { updateTypingIndicator, updateTaskStatus } from './ui-utils.js';
import { parseOutputTags } from './parser.js';
import { generateQuietly } from './generator/generator.js';

/**
 * Executes a single task, including prompt expansion, generation, and retry logic.
 */
export async function runTask(node, nodeIndex, stepIdx, totalSteps, contextVault, cleanChat, signal, options = {}) {
    const stContext = SillyTavern.getContext();
    const taskIdIndx = nodeIndex + 1;

    const taskId = node.id;
    const updateStatus = (status, label = null) => updateTaskStatus(taskId, status, label);

    // 1. Preset Management
    const taskPreset = node.preset || 'Current';
    if (taskPreset !== 'Current') {
        const currentPreset = getCurrentPresetName();
        if (currentPreset !== taskPreset) {
            logger.info(`Applying task preset: "${taskPreset}" (was: "${currentPreset}")`);
            updateStatus('applying preset');
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


    // 2. Update Progress Metadata (Now handled by orchestrator, but we ensure status is 'generating' here)
    updateStatus('generating');

    logger.debug(`Task Start: "${node.label || node.id}" (Profile: ${profileDisplayName}, API: ${taskApi})`);

    if (stContext.eventSource) {
        stContext.eventSource.emit('polyceph-task-started', {
            taskId: node.id,
            label: node.label || 'Unnamed Task',
            profile: profileDisplayName,
            api: taskApi,
            model: taskModel,
            stepIdx,
            totalSteps
        });
    }

    try {
        // 4. Prompt Expansion
        const prompt = await expandPrompt(node.template || '', settings, contextVault, cleanChat, stContext);

        if (signal.aborted) return null;

        let lastRawResponse = null;
        let parsedResult = null;

        // 4b. Build streaming options
        const streamingOptions = {
            streaming: node.streaming !== false,
            antiLoop: node.antiLoop !== false,
            loopThreshold: settings.loopDetectionThreshold || 3,
            onStream: null, // Can be set by orchestrator for character message streaming
            outputType: node.outputType || 'internal',
            allowTools: node.allowTools !== false,
            polyceph_task_id: node.id,
            polyceph_task_label: node.label || 'Unnamed Task',
            skipSuccessRecursion: !!node.skipSuccessRecursion,
            hideSuccessResponse: !!node.hideSuccessResponse,
            hideToolHistory: !!node.hideToolHistory,
            onStatusUpdate: updateTaskStatus
        };

        // Allow orchestrator to inject a stream callback (for character message streaming)
        if (typeof options?.onStream === 'function') {
            streamingOptions.onStream = options.onStream;
        }

        let attempt = 0;
        const maxAttempts = Math.max(1, settings.maxRetries || 1);

        // 5. Generation Loop (Retries)
        while (attempt < maxAttempts) {
            attempt++;
            if (signal.aborted) return null;

            try {
                const rawRes = await generateQuietly(node.profile, prompt, taskApi, signal, streamingOptions);
                lastRawResponse = rawRes;

                if (signal.aborted) return null;

                const isEmpty = !rawRes || rawRes.trim() === "" || rawRes === "(Generation returned empty)" || rawRes === "(Error during generation)";

                if (!isEmpty) {
                    parsedResult = parseOutputTags(rawRes, node.label || `Task ${taskIdIndx}`, profileDisplayName, node.persist && !node.isCharacter, node.outputType === 'tool');
                    logger.debug(`Task ${node.id} ("${node.label || 'Step'}") parsed: ${parsedResult.thoughts.length} thoughts, ${parsedResult.hiddenBackgrounds.length} backgrounds, ${parsedResult.cleanOutput.length} chars text.`);
                    break;
                }

                if (attempt >= maxAttempts) {
                    throw new Error(lastRawResponse || "Generation returned empty after all attempts.");
                }
            } catch (e) {
                if (e.message === 'Aborted' || e.message === 'Loop detected') {
                    if (e.message === 'Loop detected' && attempt < maxAttempts) {
                        logger.warn(`Task ${node.id} attempt ${attempt}: loop detected. Retrying...`);
                        toastr.warning(`Loop detected. Retrying (${attempt}/${maxAttempts})...`, 'Polyceph');
                        // Fallthrough to delay and retry
                    } else {
                        throw e;
                    }
                } else {
                    lastRawResponse = e.message;
                    if (attempt >= maxAttempts) {
                        throw e;
                    }
                    logger.warn(`Task ${node.id} attempt ${attempt} failed: ${e.message}. Retrying...`);
                    toastr.warning(`Task failed. Retrying (${attempt}/${maxAttempts})...`, 'Polyceph');
                }
            }

            const delayWait = Number(settings.retryDelayMs) || 2000;
            await new Promise(resolve => {
                const timer = setTimeout(resolve, delayWait);
                if (signal) {
                    signal.addEventListener('abort', () => {
                        clearTimeout(timer);
                        resolve();
                    }, { once: true });
                }
            });
            if (signal && signal.aborted) return null;
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
