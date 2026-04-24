import { MODULE_NAME } from './constants.js';
import { settings, switchProfile, getActivePipeline, availableProfiles } from './state.js';
import { generateId } from './utils.js';

export async function generateQuietly(profileName, prompt) {
    if (!profileName || profileName === 'none') return prompt;

    try {
        const context = SillyTavern.getContext();

        let responseData = "";

        let apiPromise;

        if (typeof context.generateRaw === 'function') {
            apiPromise = context.generateRaw({ prompt: prompt, systemPrompt: '' });
        } else if (typeof context.generateQuietPrompt === 'function') {
            console.warn(`[${MODULE_NAME}] generateRaw not found, falling back to generateQuietPrompt.`);
            apiPromise = context.generateQuietPrompt({ quietPrompt: prompt });
        } else {
            console.warn(`[${MODULE_NAME}] generateQuietPrompt not found, falling back to basic command execution.`);
            // Fallback for older ST versions
            const escaped = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
            apiPromise = context.executeSlashCommandsWithOptions(`/gen ${escaped}`, {
                handleExecutionErrors: false, handleParserErrors: false
            });
        }

        const timeoutMs = settings.generationTimeoutMs !== undefined ? settings.generationTimeoutMs : 60000;

        if (timeoutMs > 0) {
            responseData = await Promise.race([
                apiPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Generation Timeout')), timeoutMs))
            ]);
        } else {
            responseData = await apiPromise;
        }

        if (responseData) return responseData;
        return "(Generation returned empty)";
    } catch (err) {
        console.error(`[${MODULE_NAME}] generation failed:`, err);
        return "(Error during generation)";
    }
}

async function startTypingIndicator() {
    const context = SillyTavern.getContext();
    const charName = context.characters?.[context.characterId]?.name || context.name2 || 'Assistant';
    const avatarStr = typeof context.getThumbnailUrl === 'function' && context.characters?.[context.characterId] ?
        context.getThumbnailUrl('avatar', context.characters[context.characterId].avatar) : '';

    const typingMsg = {
        name: charName,
        is_user: false,
        is_system: false,
        send_date: typeof context.humanizedDateTime === 'function' ? context.humanizedDateTime() : new Date().toLocaleString(),
        mes: '...',
        force_avatar: avatarStr,
        extra: { polyceph_typing: true }
    };
    context.chat.push(typingMsg);
    if (context.eventSource && context.eventTypes) {
        await context.eventSource.emit(context.eventTypes.MESSAGE_RECEIVED, context.chat.length - 1);
    }
    if (typeof context.addOneMessage === 'function') context.addOneMessage(typingMsg);
}

async function ensureTypingIndicatorAtEnd() {
    const context = SillyTavern.getContext();
    const idx = context.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
    if (idx === -1) return;

    if (idx === context.chat.length - 1) return;

    const msg = context.chat.splice(idx, 1)[0];
    context.chat.push(msg);

    if (typeof context.renderChat === 'function') await context.renderChat();
}

async function removeTypingIndicator() {
    const context = SillyTavern.getContext();
    const idx = context.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
    if (idx === -1) return;

    if (typeof context.deleteMessage === 'function') {
        // SillyTavern 1.11+
        await context.deleteMessage(idx, undefined, false);
    } else {
        context.chat.splice(idx, 1);
        if (typeof context.renderChat === 'function') await context.renderChat();
        if (typeof context.saveChat === 'function') context.saveChat();
    }
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
    console.log(`[${MODULE_NAME}] runPipeline started`, { userInput: userInput?.substring(0, 50), batchId: generateSwipesForBatchId });
    //toastr.info('Starting Polyceph Pipeline...', 'Polyceph');
    const activePipeline = getActivePipeline();
    const pipelineName = activePipeline?.name || 'Default';
    
    const contextVault = {
        'user_input': userInput,
        'input': userInput
    };
    const batchId = generateSwipesForBatchId || 'batch_' + generateId();
    const stContext = SillyTavern.getContext();
    let accumulatedThoughts = [];

    // Fetch World Info prompt (Lorebook)
    // Filter out typing indicator from chat for macro resolution to avoid '...' in history
    const cleanChat = stContext.chat.filter(m => m && !m.extra?.polyceph_typing);

    // World Info expects a reversed array of strings (name: message)
    const chatForWI = cleanChat.map(m => `${m.name}: ${m.mes}`).reverse();
    const wiResult = await stContext.getWorldInfoPrompt(chatForWI, stContext.maxContext, false);
    const wiPrompt = wiResult?.worldInfoString || '';

    contextVault['wi'] = wiPrompt;
    contextVault['world_info'] = wiPrompt;
    contextVault['system_prompt'] = stContext.extension_settings?.formatting?.main_prompt || '';

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
                await Promise.all(groupNodes.map(async (item, k) => {
                    const { node, nodeIndex } = item;
                    const sIdIndx = i + 1;
                    const taskIdIndx = nodeIndex + 1;

                    // Stagger start to respect rate limits while allowing parallel execution
                    if (k > 0 && settings.delayMs > 0) {
                        await new Promise(r => setTimeout(r, k * settings.delayMs));
                    }

                    // Update Progress (Work started)
                    nodesStartedInStep++;
                    const progressText = `... (Step ${stepIdx}/${totalSteps} - Task ${nodesStartedInStep}/${totalNodesInStep})`;
                    const typingIdx = stContext.chat.findIndex(m => m && m.extra && m.extra.polyceph_typing);
                    if (typingIdx !== -1) {
                        stContext.chat[typingIdx].mes = progressText;
                        if (typeof stContext.updateMessageBlock === 'function') {
                            stContext.updateMessageBlock(typingIdx, stContext.chat[typingIdx]);
                        }
                    }

                    const prof = availableProfiles.find(p => p.id === node.profile);
                    const profileDisplayName = prof ? prof.name : (node.profile || 'Default');

                    let prompt = node.template || '';

                    // Polyceph-specific: {{chat_history}} and {{chat_history:X}}
                    prompt = prompt.replace(/\{\{chat_history(?::(\d+))?\}\}/g, (match, count) => {
                        let history = cleanChat.map(m => `${m.name}: ${m.mes}`);
                        if (count) {
                            const cap = parseInt(count);
                            history = history.slice(-cap);
                        }
                        return history.join('\n\n');
                    });

                    // SillyTavern Standard Macros & Step Variables
                    // This handles {{char}}, {{user}}, {{personality}}, {{wi}}, etc.
                    prompt = stContext.substituteParams(prompt, {
                        dynamicMacros: contextVault
                    });

                    let res = null;
                    let displayRes = null;
                    const maxAttempts = (settings.maxRetries !== undefined) ? settings.maxRetries : 0;

                    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
                        let rawRes = await generateQuietly(node.profile, prompt);
                        res = rawRes;
                        let localThoughts = [];

                        // Silent Thought logic
                        if (node.stripThink && rawRes) {
                            const segments = rawRes.split(/(<think>[\s\S]*?<\/think>|<think>[\s\S]*$)/gi);
                            let cleanParts = [];
                            
                            segments.forEach(segment => {
                                if (segment.toLowerCase().startsWith('<think>')) {
                                    const content = segment.replace(/<\/?think>/gi, '').trim();
                                    if (content) {
                                        localThoughts.push({
                                            title: node.label ? `${node.label} (Silent)` : `Task ${taskIdIndx} (Silent)`,
                                            content: content,
                                            isSilent: true,
                                            profile: profileDisplayName
                                        });
                                    }
                                } else {
                                    const content = segment.trim();
                                    if (content) {
                                        cleanParts.push(segment);
                                        // If this is a persist-to-thoughts task, push segment in order
                                        if (node.persist && !node.isCharacter) {
                                            localThoughts.push({
                                                title: node.label || `Task ${taskIdIndx}`,
                                                content: content,
                                                profile: profileDisplayName
                                            });
                                        }
                                    }
                                }
                            });
                            res = cleanParts.join('').trim();
                        } else if (node.persist && !node.isCharacter && res) {
                            // Non-stripped regular persistence
                            localThoughts.push({
                                title: node.label || `Task ${taskIdIndx}`,
                                content: res,
                                profile: node.profile || 'Default'
                            });
                        }

                        const isEmpty = !res || res.trim() === "" || res === "(Generation returned empty)" || res === "(Error during generation)";

                        if (!isEmpty) {
                            accumulatedThoughts.push(...localThoughts);
                            break; // Success
                        }

                        if (attempt < maxAttempts) {
                            toastr.warning(`Task failed or returned empty. Retrying (${attempt + 1}/${maxAttempts})...`, 'Polyceph');
                            const delayWait = settings.retryDelayMs !== undefined ? settings.retryDelayMs : 2000;
                            await new Promise(r => setTimeout(r, delayWait));
                        }
                    }

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
                        let postedAsCharacter = false;
                        let combinedRes = res;

                        if (node.isCharacter) {
                            let nodeThoughts = null;
                            if (accumulatedThoughts.length > 0) {
                                nodeThoughts = [...accumulatedThoughts];
                                accumulatedThoughts = [];
                            }

                            const charName = stContext.characters?.[stContext.characterId]?.name || stContext.name2 || 'Assistant';
                            const avatarStr = typeof stContext.getThumbnailUrl === 'function' && stContext.characters?.[stContext.characterId] ?
                                stContext.getThumbnailUrl('avatar', stContext.characters[stContext.characterId].avatar) : '';

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
                                const msg = {
                                    name: charName,
                                    is_user: false,
                                    is_system: false,
                                    send_date: typeof stContext.humanizedDateTime === 'function' ? stContext.humanizedDateTime() : new Date().toLocaleString(),
                                    mes: combinedRes,
                                    force_avatar: avatarStr,
                                    extra: extraData
                                };
                                stContext.chat.push(msg);
                                if (typeof stContext.addOneMessage === 'function') stContext.addOneMessage(msg);
                                if (stContext.eventSource && stContext.eventTypes) {
                                    stContext.eventSource.emit(stContext.eventTypes.MESSAGE_RECEIVED, stContext.chat.length - 1);
                                }
                            }
                            postedAsCharacter = true;
                        }

                        if (node.persist && !postedAsCharacter && !node.stripThink) {
                            accumulatedThoughts.push({
                                title: node.label || `Task ${taskIdIndx}`,
                                content: res
                            });
                        }

                        if (typeof stContext.saveChat === 'function' && postedAsCharacter) stContext.saveChat();
                    }
                })) // End Promise.all map
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
            const extraData = { model: 'polyceph', polyceph_batch: batchId, polyceph_input: userInput, polyceph_thoughts: accumulatedThoughts };
            const msg = {
                name: 'Polyceph',
                is_user: false,
                is_system: true,
                send_date: typeof stContext.humanizedDateTime === 'function' ? stContext.humanizedDateTime() : new Date().toLocaleString(),
                mes: '', // Empty message, thoughts rendered in DOM
                extra: extraData
            };
            stContext.chat.push(msg);
            if (typeof stContext.addOneMessage === 'function') stContext.addOneMessage(msg);
            if (stContext.eventSource && stContext.eventTypes) {
                stContext.eventSource.emit(stContext.eventTypes.MESSAGE_RECEIVED, stContext.chat.length - 1);
            }
            if (typeof stContext.saveChat === 'function') stContext.saveChat();
        }
        //toastr.success('Pipeline finished.', 'Polyceph');
    } catch (e) {
        toastr.error('Pipeline execution encountered an error.', 'Polyceph');
        console.error(`[${MODULE_NAME}] Pipeline Error`, e);
    } finally {
        await removeTypingIndicator();
    }
}
