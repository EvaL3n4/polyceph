import { logger } from '../../logger.js';
import { settings } from '../../state.js';
import { isChatCompletionApi, generateViaCCStreaming } from '../../compat-chat.js';
import { LoopDetector } from '../loop-detector.js';
import { _generateNonStreaming } from './api-utils.js';

/**
 * Executes the core API generation (streaming or non-streaming) with retries.
 */
export async function executeGeneration(messages, tools, tool_choice, api, signal, options) {
    const { useStreaming, antiLoop, loopThreshold, onStream, depth, polyceph_task_id, polyceph_task_label, profileId, presetName } = options;
    const canStream = useStreaming && isChatCompletionApi(api);
    
    let loopDetector = null;
    if (canStream && antiLoop) {
        loopDetector = new LoopDetector(loopThreshold);
    }

    let responseData = null;
    let attempt = 0;
    const maxAttempts = Math.max(1, settings.maxToolRetries || 1);
    const timeoutMs = settings.generationTimeoutMs !== undefined ? settings.generationTimeoutMs : 60000;

    while (attempt < maxAttempts) {
        attempt++;
        try {
            if (canStream) {
                // ========== STREAMING PATH ==========
                logger.debug(`Using streaming generation path (attempt ${attempt}/${maxAttempts}).`);

                const streamingChunkHandler = async (chunk) => {
                    // Feed loop detector
                    if (loopDetector && !chunk.done) {
                        loopDetector.feed(chunk.text.slice(loopDetector.getFullText().length));
                        if (loopDetector.isLooping()) {
                            const info = loopDetector.getLoopInfo();
                            logger.warn(`Loop detected during streaming: "${info.pattern}" (${info.repetitions}× at period ${info.patternLength})`);
                            throw new Error('Loop detected');
                        }
                    }

                    // Forward to caller's stream handler
                    if (onStream) {
                        await onStream({ text: chunk.text, reasoning: chunk.reasoning, done: chunk.done });
                    }
                };

                const streamingPromise = generateViaCCStreaming(messages, signal, streamingChunkHandler, tools, tool_choice, api, false, {
                    polyceph_task_id,
                    polyceph_task_label,
                    profileId,
                    presetName
                });

                // Build race array for timeout + abort
                const raceArr = [streamingPromise];

                if (timeoutMs > 0) {
                    raceArr.push(new Promise((_, reject) => setTimeout(() => reject(new Error('Generation Timeout')), timeoutMs)));
                }

                const abortPromise = signal ? new Promise((_, reject) => {
                    if (signal.aborted) reject(new Error('Aborted'));
                    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
                }) : null;
                if (abortPromise) raceArr.push(abortPromise);

                const streamResult = await Promise.race(raceArr);

                if (streamResult === null) {
                    // Streaming unavailable — fallback to non-streaming in next retry/loop pass
                    logger.info('Streaming returned null (unavailable). Falling back to non-streaming.');
                    responseData = await _generateNonStreaming(messages, tools, tool_choice, signal, timeoutMs, false, {
                        polyceph_task_id,
                        polyceph_task_label,
                        profileId,
                        presetName
                    });
                } else {
                    logger.debug('Streaming path successfully returned result object.');
                    responseData = streamResult;
                }
            } else {
                // ========== NON-STREAMING PATH ==========
                logger.debug(`Streaming disabled or unsupported (attempt ${attempt}/${maxAttempts}). Using non-streaming generation path.`);
                responseData = await _generateNonStreaming(messages, tools, tool_choice, signal, timeoutMs, false, {
                    polyceph_task_id,
                    polyceph_task_label,
                    profileId,
                    presetName
                });
            }

            // If we got a response, check for errors
            if (responseData?.error) {
                const err = responseData.error;
                throw new Error(err.message || JSON.stringify(err));
            }

            // If we got here, we have a valid response
            return responseData;

        } catch (err) {
            if (err.message === 'Aborted' || err.message === 'Loop detected') throw err;

            if (attempt >= maxAttempts) throw err;

            const delay = Number(settings.retryDelayMs) || 2000;
            logger.warn(`API Turn ${depth} failed (attempt ${attempt}/${maxAttempts}). Retrying in ${delay}ms...`, err);
            
            // Explicitly wait with abort signal check
            await new Promise(resolve => {
                const timer = setTimeout(resolve, delay);
                if (signal) {
                    signal.addEventListener('abort', () => {
                        clearTimeout(timer);
                        resolve();
                    }, { once: true });
                }
            });

            if (signal && signal.aborted) throw new Error('Aborted');
        }
    }
    
    return null;
}
