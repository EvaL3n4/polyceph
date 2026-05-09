import { logger } from '../logger.js';
import { settings, switchProfile, availableProfiles } from '../state.js';
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

            // 1. Pre-register ALL tasks in the step to the typing indicator as "queued"
            // This gives the user immediate feedback on what's coming, even for sequential groups.
            const currentCtx = SillyTavern.getContext();
            const typingIdx = currentCtx.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
            if (typingIdx !== -1) {
                const typingMsg = currentCtx.chat[typingIdx];
                if (!typingMsg.extra.polyceph_active_tasks) {
                    typingMsg.extra.polyceph_active_tasks = [];
                }

                step.tasks.forEach((node, nodeIndex) => {
                    const exists = typingMsg.extra.polyceph_active_tasks.find(t => t.id === node.id);
                    if (!exists) {
                        const prof = availableProfiles.find(p => p.id === node.profile);
                        const profileDisplayName = node.profile === 'none' ? '(Template Only)' : (prof ? prof.name : (node.profile || 'Default'));
                        
                        typingMsg.extra.polyceph_active_tasks.push({
                            id: node.id,
                            label: node.label || `Task ${nodeIndex + 1}`,
                            profile: profileDisplayName,
                            status: 'queued',
                            step: stepIdx,
                            totalSteps: totalSteps
                        });
                    }
                });
                import('./ui-utils.js').then(m => m.updateTypingIndicator());
            }

            if (profileId !== 'none' && profileId !== 'Task') {
                logger.info(`Switching to profile group: ${profileId}`);
                await switchProfile(profileId);
                if (signal.aborted) return;
                await new Promise(r => setTimeout(r, 1000));
                if (signal.aborted) return;
            }

            // Process tasks in parallel (staggered)
            const groupResults = new Array(groupNodes.length);
            const groupThoughts = new Array(groupNodes.length);

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
                try {
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

                        // Handle Backgrounds immediately to keep them moving
                        for (const bg of hiddenBackgrounds) {
                            if (signal.aborted) return;
                            await handleBackgroundOutput(bg, bgMsgOutputCount++, batchData, taskApi, taskModel);
                        }

                        // Buffer the result for ordered processing
                        groupResults[k] = { 
                            node, 
                            taskResult, 
                            cleanOutput, 
                            persistentOutput, 
                            taskApi, 
                            taskModel, 
                            streamMessageIndex, 
                            isStreamingSwipe 
                        };
                        groupThoughts[k] = thoughts.map(t => ({ ...t, taskId: node.id }));
                    }
                } catch (err) {
                    if (err.message === 'Aborted') throw err;
                    logger.error(`Task ${nodeIndex} in step ${stepIdx} failed:`, err);
                    groupResults[k] = { node, cleanOutput: `(Error: ${err.message})`, persistentOutput: '' };
                }
            }));

            // After group completion, process results and thoughts in original order
            for (let i = 0; i < groupNodes.length; i++) {
                const res = groupResults[i];
                if (!res) continue;

                const { node, taskResult, cleanOutput, persistentOutput, taskApi, taskModel, streamMessageIndex, isStreamingSwipe } = res;
                const taskThoughts = groupThoughts[i] || [];

                // Store in vault
                const taskIdIndx = taskResult ? taskResult.taskIdIndx : (i + 1);
                contextVault[`${step.id}_task_${taskIdIndx}`] = cleanOutput;
                contextVault[`${step.id}_target_${taskIdIndx}`] = cleanOutput;
                contextVault[`s${stepIdx}k${taskIdIndx}`] = cleanOutput;
                contextVault[`s${stepIdx}t${taskIdIndx}`] = cleanOutput;
                
                if (node.label && node.label.trim()) {
                    const labelKey = node.label.trim();
                    contextVault[labelKey] = cleanOutput;
                }

                // Prepare display result for step summation
                if (node.profile === 'none' || node.isCharacter) {
                    resultsByIndex[node.nodeIndex] = cleanOutput;
                } else {
                    const taskHeader = node.label ? node.label : `Task ${taskIdIndx}`;
                    resultsByIndex[node.nodeIndex] = `[${taskHeader}]\n${cleanOutput}`;
                }

                // Handle Character Persistence
                if (cleanOutput && (node.persist || node.isCharacter)) {
                    const content = (node.isCharacter && persistentOutput) ? persistentOutput : cleanOutput;
                    logger.debug(`Persisting task result: id=${node.id}, type=${node.outputType}, content_len=${content?.length}, isCharacter=${node.isCharacter}`);
                    
                    if (node.isCharacter) {
                        let streamingHandled = false;
                        if (streamMessageIndex !== null && streamMessageIndex !== -1) {
                            const ctx = SillyTavern.getContext();
                            const streamMsg = ctx.chat[streamMessageIndex];
                            if (streamMsg && (streamMsg.extra?.polyceph_streaming || isStreamingSwipe)) {
                                logger.debug(`Finalizing streaming message at index ${streamMessageIndex}. Content length: ${content?.length}`);
                                
                                // CONSUME accumulated thoughts
                                const combinedThoughts = [...accumulatedThoughts, ...taskThoughts];
                                accumulatedThoughts = []; // Clear the global pool
                                
                                streamMsg.mes = content;
                                streamMsg.extra.polyceph_streaming = false;
                                streamMsg.extra.polyceph_batch = batchData.batchId;
                                streamMsg.extra.polyceph_task_id = node.id;
                                streamMsg.extra.polyceph_pipeline = pipelineName;
                                streamMsg.extra.api = taskApi;
                                streamMsg.extra.model = taskModel;

                                if (Array.isArray(streamMsg.swipes)) {
                                    streamMsg.swipes[streamMsg.swipe_id] = content;
                                    if (streamMsg.swipe_info?.[streamMsg.swipe_id]) {
                                        streamMsg.swipe_info[streamMsg.swipe_id].extra = { ...streamMsg.extra };
                                    }
                                }

                                if (combinedThoughts.length > 0) {
                                    streamMsg.extra.polyceph_thoughts = combinedThoughts;
                                    if (streamMsg.swipe_info?.[streamMsg.swipe_id || 0]) {
                                        if (!streamMsg.swipe_info[streamMsg.swipe_id || 0].extra) streamMsg.swipe_info[streamMsg.swipe_id || 0].extra = {};
                                        streamMsg.swipe_info[streamMsg.swipe_id || 0].extra.polyceph_thoughts = combinedThoughts;
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

                        if (!streamingHandled) {
                            logger.debug(`Calling handleCharacterOutput for non-streamed content. Content length: ${content?.length}`);
                            
                            // CONSUME accumulated thoughts
                            const combinedThoughts = [...accumulatedThoughts, ...taskThoughts];
                            accumulatedThoughts = []; // Clear the global pool
                            
                            await handleCharacterOutput(content, combinedThoughts, node._charIndex, node, batchData, taskApi, taskModel, userInput, pipelineName);
                        }
                    } else {
                        // For non-character persistent tasks, add thoughts to the global pool
                        if (taskThoughts.length > 0) {
                            accumulatedThoughts.push(...taskThoughts);
                        }
                    }
                } else {
                    // For non-persistent tasks (like thinking-only or internal), always add thoughts to global pool
                    if (taskThoughts.length > 0) {
                        accumulatedThoughts.push(...taskThoughts);
                    }
                }

                // 6. Cleanup Task from Indicator
                const postCtx = SillyTavern.getContext();
                const tIdx = postCtx.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
                if (tIdx !== -1) {
                    const tMsg = postCtx.chat[tIdx];
                    if (tMsg.extra?.polyceph_active_tasks) {
                        tMsg.extra.polyceph_active_tasks = tMsg.extra.polyceph_active_tasks.filter(t => t.id !== node.id);
                        import('./ui-utils.js').then(m => m.updateTypingIndicator());
                    }
                }
            }
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
