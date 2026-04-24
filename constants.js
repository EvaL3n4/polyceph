export const MODULE_NAME = 'polyceph';
export const VERSION = '0.2.0';

export const defaultSettings = {
    enabled: false,
    delayMs: 250,
    generationTimeoutMs: 60000,
    maxRetries: 3,
    retryDelayMs: 2000,
    persistThoughts: false,
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
                    stripThink: false
                }
            ]
        }
    ]
};
