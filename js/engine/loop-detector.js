/**
 * engine/loop-detector.js
 * Detects repetitive output patterns in streaming LLM responses.
 *
 * Uses a sliding-window suffix matcher: after each chunk, checks if the tail
 * of the accumulated buffer contains a pattern that repeats N times consecutively.
 *
 * Shorter patterns require proportionally more repetitions to avoid false positives:
 *   requiredReps = threshold * ceil(5 / patternLength)
 *
 * Example with threshold=3:
 *   1-char pattern  → 15 reps  (5× multiplier)
 *   2-char pattern  → 9 reps   (3× multiplier)
 *   3-4 char pattern→ 6 reps   (2× multiplier)
 *   5+ char pattern → 3 reps   (1× multiplier)
 */

import { logger } from '../logger.js';

/**
 * Maximum pattern length to check (characters).
 * 500 chars covers several sentences — well beyond typical loop lengths.
 */
const MAX_PERIOD = 500;

/**
 * Minimum accumulated text length before running detection.
 * Avoids expensive checks on very short buffers.
 */
const MIN_BUFFER_LENGTH = 10;

export class LoopDetector {
    /**
     * @param {number} threshold - Base repetition count (user-configurable, typically 1-10).
     */
    constructor(threshold = 3) {
        this.threshold = threshold;
        this._buffer = '';
        this._loopDetected = false;
        this._loopInfo = null;
    }

    /**
     * Calculates how many times a pattern of a given length must repeat
     * to be considered a loop.
     * @param {number} patternLength - Length of the candidate pattern in characters.
     * @returns {number} Required repetition count.
     */
    _getRequiredReps(patternLength) {
        const multiplier = Math.max(1, Math.ceil(5 / patternLength));
        return this.threshold * multiplier;
    }

    /**
     * Appends a chunk of text to the internal buffer and runs loop detection.
     * @param {string} chunk - New text delta from the stream.
     */
    feed(chunk) {
        if (!chunk || this._loopDetected) return;

        this._buffer += chunk;

        if (this._buffer.length % 100 < chunk.length) {
            logger.debug(`LoopDetector: buffer size ${this._buffer.length} chars...`);
        }

        if (this._buffer.length < MIN_BUFFER_LENGTH) return;

        this._detect();
    }

    /**
     * Core detection: checks all period lengths from 1 up to MAX_PERIOD
     * for consecutive repetitions at the tail of the buffer.
     * @private
     */
    _detect() {
        const len = this._buffer.length;
        const maxPeriod = Math.min(MAX_PERIOD, Math.floor(len / 2));

        for (let period = 1; period <= maxPeriod; period++) {
            const requiredReps = this._getRequiredReps(period);
            const requiredLength = period * requiredReps;

            // Not enough accumulated text for this period/reps combo
            if (len < requiredLength) continue;

            // Extract the candidate pattern from the tail
            const tailStart = len - requiredLength;
            const pattern = this._buffer.slice(tailStart, tailStart + period);

            // Verify all repetitions match
            let isLoop = true;
            for (let i = 1; i < requiredReps; i++) {
                const segStart = tailStart + i * period;
                const segment = this._buffer.slice(segStart, segStart + period);
                if (segment !== pattern) {
                    isLoop = false;
                    break;
                }
            }

            if (isLoop) {
                this._loopDetected = true;
                this._loopInfo = {
                    pattern: pattern.length > 80 ? pattern.substring(0, 80) + '…' : pattern,
                    patternLength: period,
                    repetitions: requiredReps,
                };

                logger.warn(
                    `Loop detected: "${this._loopInfo.pattern}" repeated ${requiredReps}× ` +
                    `(period: ${period} chars, threshold: ${this.threshold})`
                );
                return;
            }
        }
    }

    /**
     * @returns {boolean} Whether a loop has been detected.
     */
    isLooping() {
        return this._loopDetected;
    }

    /**
     * Returns the accumulated text truncated to remove the looped portion.
     * Keeps one instance of the detected pattern at the truncation point.
     * @returns {string} Clean text up to (and including one instance of) the loop pattern.
     */
    getCleanText() {
        if (!this._loopDetected || !this._loopInfo) {
            return this._buffer;
        }

        const { patternLength, repetitions } = this._loopInfo;
        const loopedLength = patternLength * repetitions;
        // Remove the repeated portion, keeping one instance of the pattern
        const truncateAt = this._buffer.length - loopedLength + patternLength;
        return this._buffer.slice(0, truncateAt);
    }

    /**
     * Returns the full accumulated buffer without truncation.
     * @returns {string}
     */
    getFullText() {
        return this._buffer;
    }

    /**
     * Returns diagnostic info about the detected loop, or null if none.
     * @returns {object|null}
     */
    getLoopInfo() {
        return this._loopInfo;
    }

    /**
     * Resets the detector state for a new generation attempt (e.g. retry).
     */
    reset() {
        this._buffer = '';
        this._loopDetected = false;
        this._loopInfo = null;
    }
}
