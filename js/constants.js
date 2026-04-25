export const MODULE_NAME = 'polyceph';
export const VERSION = '0.3.1';

export const defaultSettings = {
    delayMs: 250,
    generationTimeoutMs: 60000,
    maxRetries: 3,
    retryDelayMs: 2000,
    activePipelineId: 'default',
    showHiddenMessages: false,
    showReasoning: true,
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
