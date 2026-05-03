export const MODULE_NAME = 'polyceph';
export const VERSION = '0.8.1';

export const defaultSettings = {
    delayMs: 250,
    generationTimeoutMs: 60000,
    maxRetries: 3,
    retryDelayMs: 2000,
    enableStreaming: true,
    loopDetectionThreshold: 3,
    toolRecursionLimit: 5,
    activePipelineId: 'default',
    interceptSend: true,
    enterBehavior: 'all',
    showPipelineSelector: true,
    showPipelineIcon: true,
    compactSelectorMode: false,
    showHiddenMessages: false,
    showReasoning: true,
    stickyTypingIndicator: false,
    restore_after_run: true,
    emulateCoreEvents: true,
    logLevel: 2,
    polycephPrompt: '',
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
                            stripThink: true,
                            antiLoop: true
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
