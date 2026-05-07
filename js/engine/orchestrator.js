import { logger } from '../logger.js';
import { settings, switchProfile } from '../state.js';
import { initializePipelineContext } from './context.js';
import { runTask } from './task-executor.js';
import { handleBackgroundOutput, handleCharacterOutput, persistReasoningMessage } from './message-manager.js';
import { postMessageToChat, getActiveCharacterInfo } from '../compat-shared.js';
import { scrollToBottomIfNear } from '../ui/ui-shared.js';

/**
 * Executes the core pipeline logic, including step iteration, task grouping,
 * and parallel LLM execution.
 */
export async function executePipelineSteps(userInput, generateSwipesForBatchId, signal) {
    // 1. Initialize Context
    const { 
        stContext, 
        activePipeline, 
        pipelineName, 
        contextVault, 
        batchId, 
        cleanChat, 
        batchData 
    } = await initializePipelineContext(userInput, generateSwipesForBatchId);

    let accumulatedThoughts = [];
    const totalSteps = activePipeline.steps.length;

    // 2. Iterate Steps
    for (let i = 0; i < totalSteps; i++) {
        const step = activePipeline.steps[i];
        const stepIdx = i + 1;

        if (!step.tasks || step.tasks.length === 0) continue;

        // Group tasks by profile to minimize ST global switches
        const profileGroups = {};
        step.tasks.forEach((node, nodeIndex) => {
            const pName = node.profile || 'Task';
            if (!profileGroups[pName]) profileGroups[pName] = [];
            profileGroups[pName].push({ node, nodeIndex });
        });

        const resultsByIndex = [];
        let charMsgOutputCount = 0;
        let bgMsgOutputCount = 0;

        // Pre-calculate message indices for parallel tasks
        step.tasks.forEach(node => {
            if (node.isCharacter || node.persist) {
                node._charIndex = charMsgOutputCount++;
            }
            // Always assign a base background index to keep them ordered
            node._bgBaseIndex = bgMsgOutputCount;
            // We don't know how many BGs yet, but we'll use this as a stable anchor
            // Actually, for BGs it's better to just use a shared counter at the moment of completion
            // but for character messages it MUST be pre-calculated.
        });

        // Process profile groups sequentially
        for (const [profileId, groupNodes] of Object.entries(profileGroups)) {
            if (signal.aborted) return;

            if (profileId !== 'none' && profileId !== 'Task') {
                logger.info(`Switching to profile group: ${profileId}`);
                await switchProfile(profileId);
                if (signal.aborted) return;
                await new Promise(r => setTimeout(r, 1000));
                if (signal.aborted) return;
            }

            // Process tasks in parallel (staggered)
            await Promise.all(groupNodes.map(async (item, k) => {
                const { node, nodeIndex } = item;

                if (k > 0 && settings.delayMs > 0) {
                    await new Promise(r => setTimeout(r, k * settings.delayMs));
                }
                if (signal.aborted) return;

                // 3. Set up streaming for character tasks
                const taskOptions = {};
                let streamMessageIndex = null;
                let isStreamingSwipe = false;

                if (node.isCharacter && settings.enableStreaming !== false) {
                    const { name: charName, avatarUrl: avatarStr } = getActiveCharacterInfo();

                    taskOptions.onStream = async ({ text, done }) => {
                        const ctx = SillyTavern.getContext();

                        // 3a. Handle placeholder or swipe anchoring on first chunk
                        if (streamMessageIndex === null && text) {
                            const charIdx = node._charIndex;
                            const isSwipe = batchData.generateSwipesForBatchId && charIdx < batchData.batchCharMessages.length;

                            if (isSwipe) {
                                const targetMsg = batchData.batchCharMessages[charIdx];
                                streamMessageIndex = ctx.chat.indexOf(targetMsg);
                                if (streamMessageIndex === -1) {
                                    streamMessageIndex = ctx.chat.findIndex(m => m.extra?.polyceph_batch === batchData.batchId && m.extra?.polyceph_task_id === node.id);
                                }

                                if (streamMessageIndex !== -1) {
                                    isStreamingSwipe = true;
                                    const msg = ctx.chat[streamMessageIndex];
                                    
                                    // Initialize swipes if missing
                                    if (!Array.isArray(msg.swipes)) {
                                        msg.swipes = [msg.mes];
                                        msg.swipe_info = [{ extra: { ...(msg.extra || {}) } }];
                                        msg.swipe_id = 0;
                                    }

                                    // Push new swipe for THIS generation
                                    msg.swipes.push('...');
                                    msg.swipe_id = msg.swipes.length - 1;
                                    msg.swipe_info.push({ extra: { polyceph_source: 'polyceph', polyceph_batch: batchData.batchId, polyceph_streaming: true } });
                                    
                                    // Set a temp state to indicate we are streaming
                                    msg.extra.polyceph_streaming = true;

                                    if (typeof ctx.swipe?.refresh === 'function') ctx.swipe.refresh(true);
                                }
                            }

                            // If not a swipe or target not found, create new message
                            if (streamMessageIndex === null || streamMessageIndex === -1) {
                                streamMessageIndex = await postMessageToChat({
                                    content: '...',
                                    name: charName,
                                    forceAvatar: avatarStr,
                                    extra: {
                                        polyceph_source: 'polyceph',
                                        polyceph_streaming: true,
                                        polyceph_batch: batchData.batchId,
                                    },
                                    save: false,
                                    silent: true,
                                });
                            }
                        }

                        if (streamMessageIndex === null || streamMessageIndex === -1) return;

                        // Update the message content
                        const msg = ctx.chat[streamMessageIndex];
                        if (!msg) return;
                        msg.mes = text;

                        // Update DOM
                        const mesEl = document.querySelector(`#chat .mes[mesid="${streamMessageIndex}"] .mes_text`);
                        if (mesEl && typeof ctx.messageFormatting === 'function') {
                            mesEl.innerHTML = ctx.messageFormatting(text, msg.name, false, false, streamMessageIndex);
                        }

                        // Auto-scroll during streaming
                        if (!done) {
                            scrollToBottomIfNear();
                        }
                    };
                }

                // 4. Run Task
                const taskResult = await runTask(node, nodeIndex, stepIdx, totalSteps, contextVault, cleanChat, signal, taskOptions);
                if (!taskResult || signal.aborted) return;

                if (taskResult.error) {
                    throw new Error(`[Task: ${node.label || node.id}] ${taskResult.error}`);
                }

                const { parsedResult, taskApi, taskModel, profileDisplayName } = taskResult;
                
                if (parsedResult) {
                    let { cleanOutput, persistentOutput, thoughts, hiddenBackgrounds } = parsedResult;
                    
                    // Honor the "Hide Success Response" flag
                    if (node.hideSuccessResponse) {
                        logger.debug(`Task ${node.id}: hideSuccessResponse is true. Silencing output.`);
                        cleanOutput = '';
                    }

                    // Store in vault
                    contextVault[`${step.id}_task_${taskResult.taskIdIndx}`] = cleanOutput;
                    contextVault[`${step.id}_target_${taskResult.taskIdIndx}`] = cleanOutput; // Legacy support
                    contextVault[`s${stepIdx}k${taskResult.taskIdIndx}`] = cleanOutput;
                    contextVault[`s${stepIdx}t${taskResult.taskIdIndx}`] = cleanOutput; // Legacy support
                    
                    if (node.label && node.label.trim()) {
                        const labelKey = node.label.trim();
                        contextVault[labelKey] = cleanOutput;
                        logger.debug(`Stored result for label "${labelKey}":`, cleanOutput);
                    }

                    // Prepare display result
                    if (node.profile === 'none' || node.isCharacter) {
                        resultsByIndex[nodeIndex] = cleanOutput;
                    } else {
                        const taskHeader = node.label ? node.label : `Task ${taskResult.taskIdIndx}`;
                        resultsByIndex[nodeIndex] = `[${taskHeader}]\n${cleanOutput}`;
                    }

                    accumulatedThoughts.push(...thoughts);

                    // 4. Handle Backgrounds (Sequential access to the counter is fine here as it's within a single task's result processing)
                    for (const bg of hiddenBackgrounds) {
                        if (signal.aborted) return;
                        await handleBackgroundOutput(bg, bgMsgOutputCount++, batchData, taskApi, taskModel);
                    }

                    // 5. Handle Character Persistence
                    if (cleanOutput && (node.persist || node.isCharacter)) {
                        const content = node.isCharacter ? persistentOutput : cleanOutput;
                        if (node.isCharacter) {
                            const taskThoughts = accumulatedThoughts;
                            accumulatedThoughts = [];

                            let streamingHandled = false;

                            // If we already created a streaming placeholder, update it in-place
                            if (streamMessageIndex !== null && streamMessageIndex !== -1) {
                                const ctx = SillyTavern.getContext();
                                const streamMsg = ctx.chat[streamMessageIndex];
                                if (streamMsg && (streamMsg.extra?.polyceph_streaming || isStreamingSwipe)) {
                                    streamMsg.mes = content;
                                    streamMsg.extra.polyceph_streaming = false;
                                    streamMsg.extra.polyceph_batch = batchData.batchId;
                                    streamMsg.extra.polyceph_task_id = node.id;
                                    streamMsg.extra.polyceph_pipeline = pipelineName;
                                    streamMsg.extra.api = taskApi;
                                    streamMsg.extra.model = taskModel;

                                    // Also update the specific swipe entry
                                    if (Array.isArray(streamMsg.swipes)) {
                                        streamMsg.swipes[streamMsg.swipe_id] = content;
                                        if (streamMsg.swipe_info && streamMsg.swipe_info[streamMsg.swipe_id]) {
                                            streamMsg.swipe_info[streamMsg.swipe_id].extra = { ...streamMsg.extra };
                                        }
                                    }

                                    if (taskThoughts.length > 0) {
                                        streamMsg.extra.polyceph_thoughts = taskThoughts;
                                        // Also update swipe_info so the renderer (which prioritizes swipes) sees it
                                        if (streamMsg.swipe_info && streamMsg.swipe_info[streamMsg.swipe_id || 0]) {
                                            if (!streamMsg.swipe_info[streamMsg.swipe_id || 0].extra) {
                                                streamMsg.swipe_info[streamMsg.swipe_id || 0].extra = {};
                                            }
                                            streamMsg.swipe_info[streamMsg.swipe_id || 0].extra.polyceph_thoughts = taskThoughts;
                                            streamMsg.swipe_info[streamMsg.swipe_id || 0].extra.polyceph_pipeline = pipelineName;
                                        }
                                    }

                                    if (typeof ctx.updateMessageBlock === 'function') {
                                        ctx.updateMessageBlock(streamMessageIndex, streamMsg);
                                    }
                                    await (typeof ctx.saveChat === 'function' ? ctx.saveChat() : Promise.resolve());
                                    streamingHandled = true;
                                }
                            }

                            // Fall back to normal handleCharacterOutput if streaming didn't handle it
                            if (!streamingHandled) {
                                await handleCharacterOutput(content, taskThoughts, node._charIndex, node, batchData, taskApi, taskModel, userInput, pipelineName);
                            }
                        }
                    }
                }
            }));
        }
        // Store step results

        const stepResult = resultsByIndex.join('\n\n---\n\n');
        contextVault[step.id] = stepResult;
        contextVault[`s${stepIdx}`] = stepResult;
        if (step.label) contextVault[step.label.trim()] = stepResult;
    }

    // 6. Final Thoughts Persistence
    if (accumulatedThoughts.length > 0 && !signal.aborted) {
        await persistReasoningMessage(accumulatedThoughts, batchData);
    }
}
