import { logger } from '../logger.js';
import { settings, switchProfile } from '../state.js';
import { initializePipelineContext } from './context.js';
import { runTask } from './task-executor.js';
import { handleBackgroundOutput, handleCharacterOutput, persistReasoningMessage } from './message-manager.js';

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

                // 3. Run Task
                const taskResult = await runTask(node, nodeIndex, stepIdx, totalSteps, contextVault, cleanChat, signal);
                if (!taskResult || signal.aborted) return;

                if (taskResult.error) {
                    throw new Error(`[Task: ${node.label || node.id}] ${taskResult.error}`);
                }

                const { parsedResult, taskApi, taskModel, profileDisplayName } = taskResult;
                
                if (parsedResult) {
                    const { cleanOutput, persistentOutput, thoughts, hiddenBackgrounds } = parsedResult;
                    
                    // Store in vault
                    contextVault[`${step.id}_task_${taskResult.taskIdIndx}`] = cleanOutput;
                    contextVault[`${step.id}_target_${taskResult.taskIdIndx}`] = cleanOutput; // Legacy support
                    contextVault[`s${stepIdx}k${taskResult.taskIdIndx}`] = cleanOutput;
                    contextVault[`s${stepIdx}t${taskResult.taskIdIndx}`] = cleanOutput; // Legacy support
                    if (node.label) contextVault[node.label.trim()] = cleanOutput;

                    // Prepare display result
                    if (node.profile === 'none' || node.isCharacter) {
                        resultsByIndex[nodeIndex] = cleanOutput;
                    } else {
                        const taskHeader = node.label ? node.label : `Task ${taskResult.taskIdIndx}`;
                        resultsByIndex[nodeIndex] = `[${taskHeader}]\n${cleanOutput}`;
                    }

                    accumulatedThoughts.push(...thoughts);

                    // 4. Handle Backgrounds
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
                            await handleCharacterOutput(content, taskThoughts, charMsgOutputCount++, node, batchData, taskApi, taskModel, userInput, pipelineName);
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
        await persistReasoningMessage(accumulatedThoughts, batchData, userInput);
    }
}
