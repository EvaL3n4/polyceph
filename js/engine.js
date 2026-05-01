import { MODULE_NAME, generationMutexEvents } from './constants.js';
import { settings, switchProfile, getActivePipeline, availableProfiles, saveSettings, clearProfileState } from './state.js';
import { generateId, waitForApiReady } from './utils.js';
import { expandPrompt } from './macros.js';
import { getMaxContextTokens, getMaxResponseTokens, countTokens, generateViaApi, postMessageToChat, ensureChatSaved, getWorldInfoForChat, getActiveCharacterInfo, getMainSystemPrompt } from './compat-shared.js';
import { clearPresetState, applyPreset, getCurrentPresetName } from './compat-presets.js';
import { logger } from './logger.js';

// Sub-modules
import { forceHideStopButton, startTypingIndicator, removeTypingIndicator, updateTypingIndicator, clearOrphanedIndicators } from './engine/ui-utils.js';
import { parseOutputTags, parsePromptToMessages } from './engine/parser.js';
import { captureSessionState, restoreSessionState } from './engine/state-manager.js';
import { finalizePipelineTeardown } from './engine/teardown.js';

// Re-exports for backward compatibility with index.js and other files
export { forceHideStopButton, startTypingIndicator, removeTypingIndicator, updateTypingIndicator, clearOrphanedIndicators };
export { parseOutputTags, parsePromptToMessages };
export { captureSessionState, restoreSessionState };
export { finalizePipelineTeardown };

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

export async function generateQuietly(profileName, prompt, api = '', signal = null) {
    if (!profileName || profileName === 'none') return prompt;

    // Ensure API is ready and settled before starting generation
    await waitForApiReady(3000);

    if (signal && signal.aborted) throw new Error('Aborted');

    try {
        const context = SillyTavern.getContext();

        // --- Compatibility: Token limit check ---
        const maxPromptTokens = getMaxContextTokens() - getMaxResponseTokens();
        const promptTokens = await countTokens(prompt);
        if (promptTokens > maxPromptTokens) {
            logger.warn(`Prompt (${promptTokens} tokens) exceeds max prompt budget (${maxPromptTokens} tokens). Generation may be truncated by the API.`);
        }

        let responseData = "";

        // Parse prompt into role-based messages
        const messages = parsePromptToMessages(prompt, api);
        const apiPromise = generateViaApi(messages);

        const timeoutMs = settings.generationTimeoutMs !== undefined ? settings.generationTimeoutMs : 60000;

        const abortPromise = signal ? new Promise((_, reject) => {
            if (signal.aborted) reject(new Error('Aborted'));
            signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
        }) : null;

        if (timeoutMs > 0) {
            const raceArr = [
                apiPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Generation Timeout')), timeoutMs))
            ];
            if (abortPromise) raceArr.push(abortPromise);

            responseData = await Promise.race(raceArr);
        } else {
            responseData = await (abortPromise ? Promise.race([apiPromise, abortPromise]) : apiPromise);
        }

        // NOTE: Stop string handling is delegated to SillyTavern's native pipeline.
        // generateRaw() internally passes stop sequences to the API via:
        //   - Chat: createGenerationParameters() → stop: getCustomStoppingStrings()
        //   - Text: createTextGenGenerationData() → stopping_strings + stop
        // Post-processing is intentionally not performed here to avoid
        // truncating valid content that contains stop-string-like text.

        if (responseData) return responseData;
        return "(Generation returned empty)";
    } catch (err) {
        logger.error('generation failed:', err);
        return "(Error during generation)";
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

    if (typeof window.is_send_press !== 'undefined') window.is_send_press = true;

    logger.info('runPipeline started', { userInput: userInput?.substring(0, 50), batchId: generateSwipesForBatchId });

    // Start typing indicator immediately so users and extensions see it
    if (generateSwipesForBatchId && triggeringUserMesId !== -1) {
        const userMsg = stContext.chat[triggeringUserMesId];
        if (userMsg) {
            if (!userMsg.extra) userMsg.extra = {};
            userMsg.extra.polyceph_typing = true;
            userMsg.extra.polyceph_active_tasks = [];
            if (typeof stContext.updateMessageBlock === 'function') {
                stContext.updateMessageBlock(triggeringUserMesId, userMsg);
            }
        }
    } else {
        await startTypingIndicator();
    }
    logger.debug('Typing indicator started.');

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
        const isPolycephTyping = !!typingMsg;
        logger.debug('Extension wait phase', { isPolycephTyping, typingIdx, hasExtra: !!typingMsg?.extra });
        if (isPolycephTyping) {
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

        // Keep 'Waiting for Extensions' visible until first task starts
        // (Removing the filter block that previously cleared it immediately)


        await stContext.eventSource.emit(stContext.eventTypes.GENERATION_AFTER_COMMANDS, 'normal', emulateOptions, false);

        // Ensure all extension metadata (like Tracker-Enhanced temp trackers) is synced to the server 
        // before we start switching profiles or presets, which might reload the state and wipe un-saved changes.
        await ensureChatSaved();

        // Recapture mutex AFTER core events for the actual pipeline execution.
        await stContext.eventSource.emit(generationMutexEvents.MUTEX_CAPTURED, { extension_name: MODULE_NAME });

        logger.debug('Mutex captured and core events fired. Proceeding with pipeline.');
        logger.debug('Pipeline active with mutex lock.');
        logger.debug('Core events finished. Active injections:', Object.keys(stContext.extension_prompts || {}));
    }

    // 1. Capture current state for restoration
    captureSessionState();

    const activePipeline = getActivePipeline();
    const pipelineName = activePipeline?.name || 'Default';

    const contextVault = {
        'user_input': userInput,
        'input': userInput
    };
    const batchId = generateSwipesForBatchId || 'batch_' + generateId();
    let accumulatedThoughts = [];

    // Filter out typing indicator from chat for macro resolution to avoid '...' in history
    const cleanChat = stContext.chat.filter(m => m && !m.extra?.polyceph_typing && !m.is_system && !m.mes?.trim().startsWith('/'));

    // Fetch World Info prompt (Lorebook)
    const wiPrompt = await getWorldInfoForChat(cleanChat);

    contextVault['wi'] = wiPrompt;
    contextVault['world_info'] = wiPrompt;
    contextVault['system_prompt'] = getMainSystemPrompt();
    contextVault['polyceph_prompt'] = settings.polycephPrompt || '';

    // Chat Completion API Prompts are now resolved dynamically in macros.js via resolveCCMacros
    // during the expandPrompt call. We keep contextVault for other dynamic variables.


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

    try {
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
        const activePipeline = getActivePipeline();
        const totalSteps = activePipeline.steps.length;

        for (let i = 0; i < activePipeline.steps.length; i++) {
            const step = activePipeline.steps[i];
            const stepIdx = i + 1;
            const totalNodesInStep = step.tasks ? step.tasks.length : 0;
            let nodesStartedInStep = 0;
            let nodesCompletedInStep = 0;
            const isLastStep = i === activePipeline.steps.length - 1;

            if (!step.tasks || step.tasks.length === 0) continue;

            // Group tasks by profile to minimize ST global switches and race conditions
            const profileGroups = {};
            step.tasks.forEach((node, nodeIndex) => {
                const pName = node.profile || 'Task';
                if (!profileGroups[pName]) profileGroups[pName] = [];
                profileGroups[pName].push({ node, nodeIndex });
            });

            const resultsByIndex = [];
            // Counters shared across parallel tasks in this step
            // (JS is single-threaded so atomic increments between awaits are safe)
            let charMsgOutputCount = 0;
            let bgMsgOutputCount = 0;

            // Process each profile group sequentially
            for (const [profileId, groupNodes] of Object.entries(profileGroups)) {
                if (signal.aborted) return;

                if (profileId !== 'none' && profileId !== 'Task') {
                    logger.info(`Switching to profile group: ${profileId}`);
                    await switchProfile(profileId);
                    if (signal.aborted) return;
                    // Allow ST UI state to settle profile load
                    await new Promise(r => setTimeout(r, 1000));
                    if (signal.aborted) return;
                }

                // Process tasks in parallel (staggered by delayMs)
                // Process tasks in parallel (staggered by delayMs)
                await Promise.all(groupNodes.map(async (item, k) => {
                    const { node, nodeIndex } = item;
                    const sIdIndx = i + 1;
                    const taskIdIndx = nodeIndex + 1;

                    // Stagger start to respect rate limits while allowing parallel execution
                    if (k > 0 && settings.delayMs > 0) {
                        await new Promise(r => setTimeout(r, k * settings.delayMs));
                    }
                    if (signal.aborted) return;

                    // Per-task preset override
                    const taskPreset = node.preset || 'Current';
                    let presetSwitched = false;
                    if (taskPreset !== 'Current') {
                        const currentPreset = getCurrentPresetName();
                        if (currentPreset !== taskPreset) {
                            logger.info(`Applying task preset: "${taskPreset}" (was: "${currentPreset}")`);
                            presetSwitched = applyPreset(taskPreset);
                            if (presetSwitched) {
                                await new Promise(r => setTimeout(r, 300));
                            } else {
                                logger.error(`Failed to apply preset "${taskPreset}". It may not exist for the active API.`);
                            }
                        }
                    } else {
                        // Ensure we are back to the original captured preset for "Current" tasks
                        restorePresetState();
                    }

                    // Resolve profile name for metadata
                    const prof = availableProfiles.find(p => p.id === node.profile);
                    const profileDisplayName = prof ? prof.name : (node.profile || 'Default');

                    // Update Progress Metadata
                    nodesStartedInStep++;
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

                    // Resolve API/Model for this task to enable provider icons and tooltips
                    let taskApi = '';
                    let taskModel = '';
                    if (node.profile && node.profile !== 'current') {
                        const prof = availableProfiles.find(p => p.id === node.profile || p.name === node.profile);
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

                    logger.debug(`Task Start: "${node.label || node.id}" (Profile: ${profileDisplayName}, API: ${taskApi})`);

                    try {
                        // Fully expand the prompt using the new recursive macro system
                        const prompt = await expandPrompt(node.template || '', settings, contextVault, cleanChat, stContext, wiPrompt);
                        logger.debug(`Task Prompt Resolved (${node.label || node.id}): ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`);

                        if (signal.aborted) return;

                        let res = null;
                        let displayRes = null;
                        const maxAttempts = (settings.maxRetries !== undefined) ? settings.maxRetries : 0;

                        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
                            if (signal.aborted) return;
                            let rawRes = await generateQuietly(node.profile, prompt, taskApi, signal);
                            logger.debug(`Task Response Raw (${node.label || node.id}, Attempt ${attempt + 1}): ${rawRes?.substring(0, 100)}${rawRes?.length > 100 ? '...' : ''}`);
                            if (signal.aborted) return;

                            if (!rawRes) {
                                res = rawRes;
                            } else {
                                const { cleanOutput, persistentOutput, thoughts, hiddenBackgrounds } = parseOutputTags(rawRes, node.label || `Task ${taskIdIndx}`, profileDisplayName, node.persist && !node.isCharacter);
                                res = cleanOutput;
                                displayRes = persistentOutput;
                                accumulatedThoughts.push(...thoughts);

                                // Handle hidden backgrounds
                                for (const bg of hiddenBackgrounds) {
                                    if (signal.aborted) return;
                                    if (generateSwipesForBatchId && bgMsgOutputCount < batchBgMessages.length) {
                                        // Update existing background message as a swipe
                                        const targetBg = batchBgMessages[bgMsgOutputCount];
                                        let actualBgIdx = stContext.chat.indexOf(targetBg);
                                        if (actualBgIdx === -1) {
                                            actualBgIdx = stContext.chat.findIndex(m => m.extra?.polyceph_batch === batchId && m.extra?.polyceph_hidden && m.mes === targetBg.mes);
                                        }

                                        // Ensure swipes array exists (guard for legacy messages)
                                        if (!Array.isArray(targetBg.swipes)) {
                                            targetBg.swipes = [targetBg.mes];
                                            targetBg.swipe_info = [{ extra: { ...(targetBg.extra || {}) } }];
                                            targetBg.swipe_id = 0;
                                        }
                                        targetBg.swipes.push(bg);
                                        targetBg.swipe_id = targetBg.swipes.length - 1;
                                        targetBg.mes = bg;
                                        // Metadata for this specific background swipe
                                        const bgExtra = {
                                            polyceph_source: 'polyceph',
                                            polyceph_hidden: true,
                                            polyceph_batch: batchId,
                                            api: taskApi,
                                            model: taskModel
                                        };
                                        targetBg.swipe_info.push({ extra: bgExtra });
                                        targetBg.extra = { ...bgExtra };

                                        if (actualBgIdx !== -1 && typeof stContext.updateMessageBlock === 'function') {
                                            stContext.updateMessageBlock(actualBgIdx, targetBg);
                                        }

                                        if (typeof stContext.swipe?.refresh === 'function') {
                                            stContext.swipe.refresh(true);
                                        }

                                        if (typeof stContext.saveChat === 'function') stContext.saveChat();
                                    } else {
                                        // New background (pipeline produced more than last run)
                                        postMessageToChat({
                                            content: bg,
                                            name: 'Background',
                                            extra: { polyceph_source: 'polyceph', polyceph_hidden: true, polyceph_batch: batchId },
                                            save: true,
                                            api: taskApi,
                                            model: taskModel,
                                        });
                                    }
                                    bgMsgOutputCount++;
                                }
                            }

                            const isEmpty = !rawRes || rawRes.trim() === "" || rawRes === "(Generation returned empty)" || rawRes === "(Error during generation)";

                            if (!isEmpty) {
                                break; // Success
                            }

                            if (attempt < maxAttempts) {
                                toastr.warning(`Task failed or returned empty. Retrying (${attempt + 1}/${maxAttempts})...`, 'Polyceph');
                                const delayWait = settings.retryDelayMs !== undefined ? settings.retryDelayMs : 2000;
                                await new Promise(r => setTimeout(r, delayWait));
                            }
                        }

                        if (signal.aborted) return;

                        // Assign to vault variants
                        contextVault[`${step.id}_task_${taskIdIndx}`] = res;
                        contextVault[`${step.id}_target_${taskIdIndx}`] = res; // Legacy support
                        contextVault[`s${sIdIndx}k${taskIdIndx}`] = res;
                        contextVault[`s${sIdIndx}t${taskIdIndx}`] = res; // Legacy support
                        if (node.label) {
                            contextVault[node.label.trim()] = res;
                        }

                        if (node.profile === 'none' || node.isCharacter) {
                            // Keep text clean for character/template tasks
                            resultsByIndex[nodeIndex] = res;
                        } else {
                            // Wrap normally for system-style persistence
                            const taskHeader = node.label ? node.label : `Task ${taskIdIndx}`;
                            resultsByIndex[nodeIndex] = `[${taskHeader}]\n${res}`;
                        }

                        // Task-Level Persistence
                        nodesCompletedInStep++;

                        if (res && (node.persist || node.isCharacter)) {
                            let combinedRes = node.isCharacter ? displayRes : res;

                            if (node.isCharacter) {
                                let nodeThoughts = null;
                                if (accumulatedThoughts.length > 0) {
                                    nodeThoughts = [...accumulatedThoughts];
                                    accumulatedThoughts = [];
                                }

                                const { name: charName, avatarUrl: avatarStr } = getActiveCharacterInfo();

                                const extraData = {
                                    polyceph_source: 'polyceph',
                                    polyceph_batch: batchId,
                                    polyceph_input: userInput,
                                    polyceph_task_id: node.id,
                                    polyceph_pipeline: pipelineName
                                };
                                if (nodeThoughts) {
                                    extraData.polyceph_thoughts = nodeThoughts;
                                }

                                let targetSwipeId = -1;
                                if (generateSwipesForBatchId && charMsgOutputCount < batchCharMessages.length) {
                                    targetSwipeId = charMsgOutputCount;
                                }
                                charMsgOutputCount++;

                                if (targetSwipeId !== -1) {
                                    const targetMessage = batchCharMessages[targetSwipeId];
                                    let actualMesId = stContext.chat.indexOf(targetMessage);
                                    if (actualMesId === -1) {
                                        // Fallback if reference was lost (e.g. ST replaced object)
                                        actualMesId = stContext.chat.findIndex(m => m.extra?.polyceph_task_id === node.id && m.extra?.polyceph_batch === batchId);
                                    }

                                    // Ensure swipes array exists (guard for legacy messages)
                                    if (!Array.isArray(targetMessage.swipes)) {
                                        targetMessage.swipes = [targetMessage.mes];
                                        targetMessage.swipe_info = [{ extra: { ...(targetMessage.extra || {}) } }];
                                        targetMessage.swipe_id = 0;
                                    }
                                    targetMessage.swipes.push(combinedRes);
                                    targetMessage.swipe_id = targetMessage.swipes.length - 1;

                                    // Update current metadata to reflect the generator of this specific swipe
                                    targetMessage.extra = { ...extraData };
                                    targetMessage.extra.api = taskApi;
                                    targetMessage.extra.model = taskModel;

                                    targetMessage.swipe_info.push({ extra: { ...targetMessage.extra } });
                                    targetMessage.mes = combinedRes;

                                    if (actualMesId !== -1 && typeof stContext.updateMessageBlock === 'function') {
                                        stContext.updateMessageBlock(actualMesId, targetMessage);

                                        if (typeof stContext.saveChat === 'function') stContext.saveChat();

                                        if (typeof stContext.swipe?.refresh === 'function') {
                                            stContext.swipe.refresh(true);
                                        }

                                        // Final message event handled at pipeline level if enabled
                                    }
                                } else {
                                    if (signal.aborted) return;
                                    postMessageToChat({
                                        content: combinedRes,
                                        name: charName,
                                        forceAvatar: avatarStr,
                                        extra: extraData,
                                        api: taskApi,
                                        model: taskModel,
                                        silent: true, // Extensions wait until pipeline end
                                    });
                                }
                            }
                        }
                    } catch (e) {
                        logger.error(`Task failed: Step ${sIdIndx}, Task ${taskIdIndx}`, e);
                        resultsByIndex[nodeIndex] = `Error: ${e.message}`;
                    } finally {
                        // Task completion cleanup
                        const typingIdx = stContext.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
                        if (typingIdx !== -1) {
                            const typingMsg = stContext.chat[typingIdx];
                            if (typingMsg.extra.polyceph_active_tasks) {
                                typingMsg.extra.polyceph_active_tasks = typingMsg.extra.polyceph_active_tasks.filter(t => t.id !== node.id);
                                updateTypingIndicator();
                            }
                        }
                    }
                })); // End Promise.all map
            } // End profileGroups loop

            const combinedResult = resultsByIndex.join('\n\n---\n\n');
            const sIdIndxOuter = i + 1;

            contextVault[step.id] = combinedResult;
            contextVault[`s${sIdIndxOuter}`] = combinedResult;
            if (step.label) {
                contextVault[step.label.trim()] = combinedResult;
            }
        }

        // Handle any leftover thoughts that weren't printed because there was no final character message
        if (accumulatedThoughts.length > 0 && !signal.aborted) {
            if (generateSwipesForBatchId && batchReasoningMsg) {
                // Swipe the existing reasoning message
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
                batchReasoningMsg.extra.polyceph_thoughts = accumulatedThoughts;
                batchReasoningMsg.swipe_info.push({ extra: { polyceph_thoughts: accumulatedThoughts } });
                if (typeof stContext.updateMessageBlock === 'function') {
                    stContext.updateMessageBlock(rIdx, batchReasoningMsg);
                }
                if (typeof stContext.saveChat === 'function') stContext.saveChat();
            } else {
                postMessageToChat({
                    content: '', // Empty message, thoughts rendered in DOM
                    name: 'Polyceph Reasoning',
                    extra: { polyceph_source: 'polyceph', polyceph_batch: batchId, polyceph_input: userInput, polyceph_thoughts: accumulatedThoughts },
                    api: stContext.mainApi,
                    model: stContext.model,
                });
            }
        }

        //toastr.success('Pipeline finished.', 'Polyceph');
    } catch (e) {
        toastr.error('Pipeline execution encountered an error.', 'Polyceph');
        logger.error('Pipeline Error', e);
    } finally {
        // 1. Immediate UI Cleanup - Ensure the typing indicator is gone before anything else
        // We do this immediately in the finally block to catch errors and aborts.
        await removeTypingIndicator();
        forceHideStopButton();
        await removeTypingIndicator(); // Final safety sweep

        // Give UI a moment to settle before restoration
        await new Promise(r => setTimeout(r, 100));

        // Restore the user's original session state and clean up
        await restoreSessionState();
        await removeTypingIndicator(); // Triple safety check after restoration reload
        currentPipelineAbortController = null;
        const stContextEnd = SillyTavern.getContext();

        // 3. Final Event Emulation & Mutex Release
        await finalizePipelineTeardown();
    }
}
