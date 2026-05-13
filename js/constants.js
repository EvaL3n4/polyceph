export const MODULE_NAME = 'polyceph';
export const VERSION = '0.10.3';
export const PIPELINE_DATA_VERSION = '1.0.0';
export const DEFAULT_TOOL_RECURSION_LIMIT = 5; //fallback

export const defaultSettings = {
    delayMs: 250,
    generationTimeoutMs: 60000,
    maxRetries: 3,
    maxToolRetries: 3,
    retryDelayMs: 2000,
    loopDetectionThreshold: 3,
    activePipelineId: 'default',
    interceptSend: true,
    enterBehavior: 'all',
    showPipelineSelector: true,
    showPipelineIcon: true,
    compactSelectorMode: false,
    showHiddenMessages: false,
    showReasoning: true,
    showOnlyLastRecursion: false,
    stickyTypingIndicator: false,
    restore_after_run: true,
    emulateCoreEvents: true,
    logLevel: 2,
    polycephPrompt: '',
    scanRangeStart: 0,
    scanRangeEnd: 100,
    scanBatchSize: 1,
    scanOffset: 0,
    scanDirection: 'forward',
    pipelines: [
        {
            id: 'default',
            name: 'Default Pipeline',
            steps: [
                {
                    id: 'step_1',
                    label: '',
                    tasks: [
                        {
                            id: 'task_1',
                            label: '',
                            profile: 'none',
                            preset: 'Current',
                            useSystem: false,
                            template: '{{user_input}}',
                            persist: false,
                            isCharacter: false,
                            outputType: 'internal',
                            stripThink: true,
                            antiLoop: true,
                            allowTools: true,
                            hideSuccessResponse: false,
                            skipSuccessRecursion: false
                        }
                    ]
                }
            ]
        }
    ]
};

export const generationMutexEvents = {
    MUTEX_CAPTURED: 'GENERATION_MUTEX_CAPTURED',
    MUTEX_RELEASED: 'GENERATION_MUTEX_RELEASED',
};
