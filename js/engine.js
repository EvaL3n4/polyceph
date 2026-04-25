import { MODULE_NAME } from './constants.js';
import { settings, switchProfile, getActivePipeline, availableProfiles, saveSettings } from './state.js';
import { generateId, waitForApiReady } from './utils.js';
import { expandPrompt } from './macros.js';
import { getMaxContextTokens, getMaxResponseTokens, countTokens, generateViaApi, postMessageToChat, getWorldInfoForChat, getActiveCharacterInfo, getMainSystemPrompt } from './compat-shared.js';
import { capturePresetState, restorePresetState, clearPresetState, applyPreset, getCurrentPresetName } from './compat-presets.js';

let currentPipelineAbortController = null;

export function stopPipeline() {
    if (currentPipelineAbortController) {
        console.log(`[${MODULE_NAME}] Pipeline STOP requested.`);
        currentPipelineAbortController.abort();
        currentPipelineAbortController = null;
        removeTypingIndicator();
        toastr.warning('Pipeline execution stopped.', 'Polyceph');
    }
}

export function parseOutputTags(rawOutput, taskId, profileDisplayName, isThinkingTask) {
    const thoughts = [];
    const hiddenBackgrounds = [];

    // Extract backgrounds first (always extracted)
    const backgroundRegex = /<background>([\s\S]*?)<\/background>/gi;
    let bgMatch;
    while ((bgMatch = backgroundRegex.exec(rawOutput)) !== null) {
        const content = bgMatch[1].trim();
        if (content) hiddenBackgrounds.push(content);
    }

    // Interleaved parsing for think/ramble and text
    const tokenRegex = /(<think>[\s\S]*?<\/think>|<ramble>[\s\S]*?<\/ramble>)/gi;
    const segments = rawOutput.split(tokenRegex);

    let cleanParts = [];
    let persistentParts = [];

    segments.forEach(segment => {
        if (!segment) return;

        if (segment.toLowerCase().startsWith('<think>')) {
            const content = segment.replace(/<\/?think>/gi, '').trim();
            if (content) {
                thoughts.push({ title: `Thinking`, content, isSilent: true, profile: profileDisplayName });
            }
        } else if (segment.toLowerCase().startsWith('<ramble>')) {
            const content = segment.replace(/<\/?ramble>/gi, '').trim();
            if (content) {
                thoughts.push({ title: `Rambling`, content, isSilent: true, profile: profileDisplayName });
                cleanParts.push(content);
            }
        } else {
            // Regular text (remove backgrounds from it)
            const content = segment.replace(backgroundRegex, '').trim();
            if (content) {
                cleanParts.push(content);
                persistentParts.push(content);

                // If it's a "Thinking" task, everything goes into the thoughts list in order
                if (isThinkingTask) {
                    thoughts.push({ title: taskId || `Task Output`, content, isSilent: false, profile: profileDisplayName });
                }
            }
        }
    });

    return {
        cleanOutput: cleanParts.join('\n\n').trim(),
        persistentOutput: persistentParts.join('\n\n').trim(),
        thoughts,
        hiddenBackgrounds
    };
}

/**
 * Parses a prompt string with [[ROLE:name]] tags into a SillyTavern message array.
 * Validates tag structure and warns about content outside role tags.
 */
function parsePromptToMessages(text) {
    const messages = [];
    const roleRegex = /\[\[ROLE:(system|user|assistant)\]\]([\s\S]*?)\[\[\/ROLE\]\]/gi;
    let lastIndex = 0;
    let match;
    let hasRoleTags = false;
    let hasOrphanedContent = false;

    while ((match = roleRegex.exec(text)) !== null) {
        hasRoleTags = true;
        const precedingText = text.substring(lastIndex, match.index).trim();
        if (precedingText) {
            hasOrphanedContent = true;
            messages.push({ role: 'system', content: precedingText });
        }
        messages.push({ role: match[1].toLowerCase(), content: match[2].trim() });
        lastIndex = roleRegex.lastIndex;
    }

    const remainingText = text.substring(lastIndex).trim();
    if (remainingText && hasRoleTags) {
        hasOrphanedContent = true;
        messages.push({ role: 'system', content: remainingText });
    } else if (remainingText) {
        messages.push({ role: 'system', content: remainingText });
    }

    if (messages.length === 0) {
        return [{ role: 'system', content: text.trim() }];
    }

    // Validation: warn about content outside role tags
    if (hasOrphanedContent) {
        console.warn(`[${MODULE_NAME}] Prompt contains text outside [[ROLE:...]] tags. This content will be sent as an implicit 'system' message. Wrap all content in role tags for explicit control.`);
    }

    // Validation: check for malformed tags that the regex didn't match
    if (hasRoleTags) {
        const openCount = (text.match(/\[\[ROLE:/gi) || []).length;
        const closeCount = (text.match(/\[\[\/ROLE\]\]/gi) || []).length;
        if (openCount !== closeCount) {
            console.warn(`[${MODULE_NAME}] Mismatched role tags: ${openCount} opening vs ${closeCount} closing. Some content may be incorrectly assigned.`);
        }
    }

    const mergedMessages = [];
    for (const msg of messages) {
        const lastMsg = mergedMessages[mergedMessages.length - 1];
        if (lastMsg && lastMsg.role === msg.role) {
            lastMsg.content += '\n\n' + msg.content;
        } else {
            mergedMessages.push(msg);
        }
    }
    return mergedMessages;
}

export async function generateQuietly(profileName, prompt) {
    if (!profileName || profileName === 'none') return prompt;

    // Ensure API is ready and settled before starting generation
    await waitForApiReady(3000);

    try {
        const context = SillyTavern.getContext();

        // --- Compatibility: Token limit check ---
        const maxPromptTokens = getMaxContextTokens() - getMaxResponseTokens();
        const promptTokens = await countTokens(prompt);
        if (promptTokens > maxPromptTokens) {
            console.warn(`[${MODULE_NAME}] Prompt (${promptTokens} tokens) exceeds max prompt budget (${maxPromptTokens} tokens). Generation may be truncated by the API.`);
        }

        let responseData = "";

        const messages = parsePromptToMessages(prompt);
        const apiPromise = generateViaApi(messages);

        const timeoutMs = settings.generationTimeoutMs !== undefined ? settings.generationTimeoutMs : 60000;

        if (timeoutMs > 0) {
            responseData = await Promise.race([
                apiPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Generation Timeout')), timeoutMs))
            ]);
        } else {
            responseData = await apiPromise;
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
        console.error(`[${MODULE_NAME}] generation failed:`, err);
        return "(Error during generation)";
    }
}

async function startTypingIndicator() {
    // No-op: Indicator is now attached to the user message in index.js
}

function updateTypingIndicator() {
    const stContext = SillyTavern.getContext();
    const typingIdx = stContext.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
    if (typingIdx !== -1 && stContext.chat[typingIdx]) {
        if (typeof stContext.updateMessageBlock === 'function') {
            stContext.updateMessageBlock(typingIdx, stContext.chat[typingIdx]);
        } else if (typeof stContext.renderChat === 'function') {
            stContext.renderChat();
        }
    }
}

async function ensureTypingIndicatorAtEnd() {
    // No-op: Anchored to user message
}

async function removeTypingIndicator() {
    const context = SillyTavern.getContext();
    const idx = context.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
    if (idx === -1) return;

    const msg = context.chat[idx];
    if (msg.extra) {
        delete msg.extra.polyceph_typing;
        delete msg.extra.polyceph_active_tasks;
    }

    if (typeof context.updateMessageBlock === 'function') {
        context.updateMessageBlock(idx, msg);
    }
    if (typeof context.saveChat === 'function') context.saveChat();
}

export async function startPipeline(text) {
    try {
        console.log(`[${MODULE_NAME}] Starting pipeline for text:`, text.substring(0, 50) + '...');
        runPipeline(text);
    } catch (err) {
        console.error(`[${MODULE_NAME}] Error starting pipeline:`, err);
    }
}

export async function runPipeline(userInput, generateSwipesForBatchId) {
    if (currentPipelineAbortController) currentPipelineAbortController.abort();
    currentPipelineAbortController = new AbortController();
    const signal = currentPipelineAbortController.signal;

    console.log(`[${MODULE_NAME}] runPipeline started`, { userInput: userInput?.substring(0, 50), batchId: generateSwipesForBatchId });
    //toastr.info('Starting Polyceph Pipeline...', 'Polyceph');

    // Capture the user's original preset before the pipeline modifies anything
    capturePresetState();

    const activePipeline = getActivePipeline();
    const pipelineName = activePipeline?.name || 'Default';

    const contextVault = {
        'user_input': userInput,
        'input': userInput
    };
    const batchId = generateSwipesForBatchId || 'batch_' + generateId();
    const stContext = SillyTavern.getContext();
    let accumulatedThoughts = [];

    // Filter out typing indicator from chat for macro resolution to avoid '...' in history
    const cleanChat = stContext.chat.filter(m => m && !m.extra?.polyceph_typing);

    // Fetch World Info prompt (Lorebook)
    const wiPrompt = await getWorldInfoForChat(cleanChat);

    contextVault['wi'] = wiPrompt;
    contextVault['world_info'] = wiPrompt;
    contextVault['system_prompt'] = getMainSystemPrompt();
    contextVault['polyceph_prompt'] = settings.polycephPrompt || '';

    // Chat Completion API Prompts are now resolved dynamically in macros.js via resolveCCMacros
    // during the expandPrompt call. We keep contextVault for other dynamic variables.


    let cleanMessagesArr = [];
    if (generateSwipesForBatchId) {
        cleanMessagesArr = stContext.chat.filter(m => m.extra && m.extra.polyceph_batch === generateSwipesForBatchId);
    }

    console.log(`[${MODULE_NAME}] Pipeline context initialized. Clean chat size:`, cleanChat.length);

    await startTypingIndicator();
    console.log(`[${MODULE_NAME}] Typing indicator started.`);

    try {
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

            // Process each profile group sequentially
            for (const [profileId, groupNodes] of Object.entries(profileGroups)) {
                if (profileId !== 'none' && profileId !== 'Task') {
                    console.log(`[${MODULE_NAME}] Switching to profile group: ${profileId}`);
                    await switchProfile(profileId);
                    // Allow ST UI state to settle profile load
                    await new Promise(r => setTimeout(r, 1000));
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

                    // Per-task preset override
                    const taskPreset = node.preset || 'Current';
                    let presetSwitched = false;
                    if (taskPreset !== 'Current') {
                        const currentPreset = getCurrentPresetName();
                        if (currentPreset !== taskPreset) {
                            console.log(`[${MODULE_NAME}] Applying task preset: "${taskPreset}" (was: "${currentPreset}")`);
                            presetSwitched = applyPreset(taskPreset);
                            if (presetSwitched) {
                                await new Promise(r => setTimeout(r, 300));
                            } else {
                                console.error(`[${MODULE_NAME}] Failed to apply preset "${taskPreset}". It may not exist for the active API.`);
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
                    const currentTypingIdx = stContext.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
                    if (currentTypingIdx !== -1) {
                        const typingMsg = stContext.chat[currentTypingIdx];
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
                        taskModel = stContext.model;
                    }

                    try {
                        // Fully expand the prompt using the new recursive macro system
                        const prompt = expandPrompt(node.template || '', settings, contextVault, cleanChat, stContext, wiPrompt);

                        if (signal.aborted) return;

                        let res = null;
                        let displayRes = null;
                        const maxAttempts = (settings.maxRetries !== undefined) ? settings.maxRetries : 0;

                        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
                            if (signal.aborted) return;
                            let rawRes = await generateQuietly(node.profile, prompt);
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
                                    postMessageToChat({
                                        content: bg,
                                        name: 'Background',
                                        extra: { model: 'polyceph', polyceph_hidden: true, polyceph_batch: batchId },
                                        save: false,
                                        api: taskApi,
                                        model: taskModel,
                                    });
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
                                    model: 'polyceph',
                                    polyceph_batch: batchId,
                                    polyceph_input: userInput,
                                    polyceph_task_id: node.id,
                                    polyceph_pipeline: pipelineName
                                };
                                if (nodeThoughts) {
                                    extraData.polyceph_thoughts = nodeThoughts;
                                }

                                let targetSwipeId = -1;
                                if (generateSwipesForBatchId) {
                                    targetSwipeId = cleanMessagesArr.findIndex(m => m.extra && m.extra.polyceph_task_id === node.id);
                                }

                                if (targetSwipeId !== -1) {
                                    const targetMessage = cleanMessagesArr[targetSwipeId];
                                    const actualMesId = stContext.chat.indexOf(targetMessage);

                                    if (!Array.isArray(targetMessage.swipes)) {
                                        targetMessage.swipes = [targetMessage.mes];
                                        targetMessage.swipe_info = [{}];
                                        targetMessage.swipe_id = 0;
                                    }

                                    targetMessage.swipes.push(combinedRes);
                                    targetMessage.swipe_id = targetMessage.swipes.length - 1;
                                    targetMessage.swipe_info.push({ extra: extraData });
                                    targetMessage.mes = combinedRes;

                                    if (typeof stContext.updateMessageBlock === 'function') {
                                        stContext.updateMessageBlock(actualMesId, targetMessage);

                                        // Update Swipe UI
                                        const mesBlock = document.querySelector(`.mes[mesid="${actualMesId}"]`);
                                        if (mesBlock) {
                                            const swipeCounter = mesBlock.querySelector('.swipe_counter');
                                            if (swipeCounter) {
                                                swipeCounter.innerText = `${targetMessage.swipe_id + 1}/${targetMessage.swipes.length}`;
                                            }
                                        }

                                        if (stContext.eventSource && stContext.eventTypes) {
                                            stContext.eventSource.emit(stContext.eventTypes.MESSAGE_RECEIVED, actualMesId);
                                        }
                                    }
                                } else {
                                    postMessageToChat({
                                        content: combinedRes,
                                        name: charName,
                                        forceAvatar: avatarStr,
                                        extra: extraData,
                                        api: taskApi,
                                        model: taskModel,
                                    });
                                }
                            }
                        }
                    } catch (e) {
                        console.error(`[${MODULE_NAME}] Task failed: Step ${sIdIndx}, Task ${taskIdIndx}`, e);
                        resultsByIndex[nodeIndex] = `Error: ${e.message}`;
                    } finally {
                        // Task completion cleanup
                        const endTypingIdx = stContext.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
                        if (endTypingIdx !== -1) {
                            const typingMsg = stContext.chat[endTypingIdx];
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
        if (accumulatedThoughts.length > 0) {
            postMessageToChat({
                content: '', // Empty message, thoughts rendered in DOM
                name: 'Polyceph Reasoning',
                extra: { model: 'polyceph', polyceph_batch: batchId, polyceph_input: userInput, polyceph_thoughts: accumulatedThoughts },
                api: stContext.mainApi,
                model: stContext.model,
            });
        }
        //toastr.success('Pipeline finished.', 'Polyceph');
    } catch (e) {
        toastr.error('Pipeline execution encountered an error.', 'Polyceph');
        console.error(`[${MODULE_NAME}] Pipeline Error`, e);
    } finally {
        // Restore the user's original preset and clean up
        restorePresetState();
        clearPresetState();
        await removeTypingIndicator();
    }
}
