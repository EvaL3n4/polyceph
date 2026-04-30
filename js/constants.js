export const MODULE_NAME = 'polyceph';
export const VERSION = '0.6.0';

export const defaultSettings = {
    delayMs: 250,
    generationTimeoutMs: 60000,
    maxRetries: 3,
    retryDelayMs: 2000,
    activePipelineId: 'default',
    interceptSend: true,
    interceptEnter: true,
    showPipelineSelector: true,
    showPipelineIcon: true,
    compactSelectorMode: false,
    showHiddenMessages: false,
    showReasoning: true,
    restore_after_run: true,
    emulateCoreEvents: true,
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
                            stripThink: true
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
