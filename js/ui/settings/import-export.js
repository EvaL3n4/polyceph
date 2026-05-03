import { VERSION, PIPELINE_DATA_VERSION } from '../../constants.js';

/**
 * Registry of migration functions.
 * Keys are the version to migrate FROM.
 * Each function should return a new object with the next version set.
 */
const MIGRATIONS = {
    // Example:
    // '1.0.0': (data) => {
    //     data.metadata.data_version = '1.1.0';
    //     return data;
    // }
};

/**
 * Migrates pipeline data through version levels until it reaches current.
 * @param {object} data - The full export data object {metadata, pipeline}
 * @returns {object} The migrated pipeline object
 */
function migratePipelineData(data) {
    if (!data.metadata || !data.metadata.data_version) {
        throw new Error('Missing metadata in import file.');
    }

    let currentVer = data.metadata.data_version;

    while (currentVer !== PIPELINE_DATA_VERSION) {
        const migrator = MIGRATIONS[currentVer];
        if (!migrator) {
            console.warn(`[Polyceph] No migration path found from version ${currentVer}. Attempting to use as-is.`);
            break;
        }
        data = migrator(data);
        currentVer = data.metadata.data_version;
    }

    return data.pipeline;
}

/**
 * Exports a pipeline to a JSON file.
 * @param {object} pipeline - The pipeline object to export
 */
export function exportPipeline(pipeline) {
    const exportData = {
        metadata: {
            polyceph_version: VERSION,
            data_version: PIPELINE_DATA_VERSION,
            exported_at: new Date().toISOString()
        },
        pipeline: {
            name: pipeline.name,
            steps: pipeline.steps
        }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `polyceph_pipeline_${pipeline.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Triggers a file picker and imports a pipeline.
 * @returns {Promise<object|null>} The imported pipeline object or null
 */
export async function importPipeline() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return resolve(null);
            
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                
                const migratedPipeline = migratePipelineData(data);
                resolve(migratedPipeline);
            } catch (err) {
                console.error('[Polyceph] Import error:', err);
                // @ts-ignore
                toastr.error(`Import failed: ${err.message}`, 'Polyceph');
                resolve(null);
            }
        };
        
        input.click();
    });
}
