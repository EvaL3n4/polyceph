import { logger } from '../logger.js';
import { settings, switchProfile, getActivePipeline, availableProfiles, clearProfileState } from '../state.js';
import { generateId, waitForApiReady } from '../utils.js';
import { expandPrompt } from '../macros.js';
import { postMessageToChat, getWorldInfoForChat, getActiveCharacterInfo, getMainSystemPrompt, ensureChatSaved, getMaxContextTokens, getMaxResponseTokens, countTokens, generateViaApi } from '../compat-shared.js';
import { getCurrentPresetName, applyPreset, restorePresetState, clearPresetState } from '../compat-presets.js';
import { updateTypingIndicator } from './ui-utils.js';
import { parseOutputTags, parsePromptToMessages } from './parser.js';
import { generateQuietly } from './generator.js';


/**
 * Executes the core pipeline logic, including step iteration, task grouping,
 * and parallel LLM execution.
 */
export async function executePipelineSteps(userInput, generateSwipesForBatchId, signal) {
    const stContext = SillyTavern.getContext();
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

    const totalSteps = activePipeline.steps.length;

    for (let i = 0; i < activePipeline.steps.length; i++) {
        const step = activePipeline.steps[i];
        const stepIdx = i + 1;
        const totalNodesInStep = step.tasks ? step.tasks.length : 0;
        let nodesStartedInStep = 0;
        let nodesCompletedInStep = 0;

        if (!step.tasks || step.tasks.length === 0) continue;

        // Group tasks by profile to minimize ST global switches and race conditions
        const profileGroups = {};
        step.tasks.forEach((node, nodeIndex) => {
            const pName = node.profile || 'Task';
            if (!profileGroups[pName]) profileGroups[pName] = [];
            profileGroups[pName].push({ node, nodeIndex });
        });

        const resultsByIndex = [];
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
                                    if (typeof stContext.swipe?.refresh === 'function') stContext.swipe.refresh(true);
                                    if (typeof stContext.saveChat === 'function') stContext.saveChat();
                                } else {
                                    // New background
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
                        if (!isEmpty) break; // Success

                        if (attempt < maxAttempts) {
                            toastr.warning(`Task failed or returned empty. Retrying (${attempt + 1}/${maxAttempts})...`, 'Polyceph');
                            const delayWait = settings.retryDelayMs !== undefined ? settings.retryDelayMs : 2000;
                            await new Promise(r => setTimeout(r, delayWait));
                        }
                    }

                    if (signal.aborted) return;

                    // Assign to vault variants
                    contextVault[`${step.id}_task_${taskIdIndx}`] = res;
                    contextVault[`${step.id}_target_${taskIdIndx}`] = res;
                    contextVault[`s${sIdIndx}k${taskIdIndx}`] = res;
                    contextVault[`s${sIdIndx}t${taskIdIndx}`] = res;
                    if (node.label) contextVault[node.label.trim()] = res;

                    if (node.profile === 'none' || node.isCharacter) {
                        resultsByIndex[nodeIndex] = res;
                    } else {
                        const taskHeader = node.label ? node.label : `Task ${taskIdIndx}`;
                        resultsByIndex[nodeIndex] = `[${taskHeader}]\n${res}`;
                    }

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
                            if (nodeThoughts) extraData.polyceph_thoughts = nodeThoughts;

                            let targetSwipeId = -1;
                            if (generateSwipesForBatchId && charMsgOutputCount < batchCharMessages.length) {
                                targetSwipeId = charMsgOutputCount;
                            }
                            charMsgOutputCount++;

                            if (targetSwipeId !== -1) {
                                const targetMessage = batchCharMessages[targetSwipeId];
                                let actualMesId = stContext.chat.indexOf(targetMessage);
                                if (actualMesId === -1) {
                                    actualMesId = stContext.chat.findIndex(m => m.extra?.polyceph_task_id === node.id && m.extra?.polyceph_batch === batchId);
                                }

                                if (!Array.isArray(targetMessage.swipes)) {
                                    targetMessage.swipes = [targetMessage.mes];
                                    targetMessage.swipe_info = [{ extra: { ...(targetMessage.extra || {}) } }];
                                    targetMessage.swipe_id = 0;
                                }
                                targetMessage.swipes.push(combinedRes);
                                targetMessage.swipe_id = targetMessage.swipes.length - 1;
                                targetMessage.extra = { ...extraData };
                                targetMessage.extra.api = taskApi;
                                targetMessage.extra.model = taskModel;
                                targetMessage.swipe_info.push({ extra: { ...targetMessage.extra } });
                                targetMessage.mes = combinedRes;

                                if (actualMesId !== -1 && typeof stContext.updateMessageBlock === 'function') {
                                    stContext.updateMessageBlock(actualMesId, targetMessage);
                                    if (typeof stContext.saveChat === 'function') stContext.saveChat();
                                    if (typeof stContext.swipe?.refresh === 'function') stContext.swipe.refresh(true);
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
                                    silent: true,
                                });
                            }
                        }
                    }
                } catch (e) {
                    logger.error(`Task failed: Step ${sIdIndx}, Task ${taskIdIndx}`, e);
                    resultsByIndex[nodeIndex] = `Error: ${e.message}`;
                } finally {
                    const typingIdx = stContext.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
                    if (typingIdx !== -1) {
                        const typingMsg = stContext.chat[typingIdx];
                        if (typingMsg.extra.polyceph_active_tasks) {
                            typingMsg.extra.polyceph_active_tasks = typingMsg.extra.polyceph_active_tasks.filter(t => t.id !== node.id);
                            updateTypingIndicator();
                        }
                    }
                }
            })); // End Promise.all
        } // End profileGroups loop

        const combinedResult = resultsByIndex.join('\n\n---\n\n');
        const sIdIndxOuter = i + 1;
        contextVault[step.id] = combinedResult;
        contextVault[`s${sIdIndxOuter}`] = combinedResult;
        if (step.label) contextVault[step.label.trim()] = combinedResult;
    }

    // Handle leftover thoughts
    if (accumulatedThoughts.length > 0 && !signal.aborted) {
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
            batchReasoningMsg.extra.polyceph_thoughts = accumulatedThoughts;
            batchReasoningMsg.swipe_info.push({ extra: { polyceph_thoughts: accumulatedThoughts } });
            if (typeof stContext.updateMessageBlock === 'function') {
                stContext.updateMessageBlock(rIdx, batchReasoningMsg);
            }
            if (typeof stContext.saveChat === 'function') stContext.saveChat();
        } else {
            postMessageToChat({
                content: '',
                name: 'Polyceph Reasoning',
                extra: { polyceph_source: 'polyceph', polyceph_batch: batchId, polyceph_input: userInput, polyceph_thoughts: accumulatedThoughts },
                api: stContext.mainApi,
                model: stContext.model,
            });
        }
    }
}
