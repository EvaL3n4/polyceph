# Polyceph

An advanced multi-model orchestration extension for SillyTavern. Define complex, user-governed reasoning pipelines that allow a single user message to trigger a multi-step, multi-connection chain-of-thought process.

## Overview
Polyceph allows you to transcend single-message AI interaction by constructing **Pipelines**. A single prompt from you can trigger a series of intermediate steps—where models can critique their own work, summarize chat history, or cross-reference multiple different API endpoints—before finally delivering a polished response into your chat.

## Installation
1. Navigate to your SillyTavern `public/scripts/extensions` folder.
2. Clone or copy this repository into a folder named `polyceph`.
3. Restart SillyTavern or refresh your browser.

## Usage Guide

1. **Open Settings**: Locate **Polyceph** in the SillyTavern extensions menu (Puzzle icon).
2. **Enable Interception**: Toggle **Enable Polyceph**. When active, your normal "Send" button will instead fire the Polyceph engine.
3. **Build your Pipeline**: Add one or more **Steps**. Each step contains one or more **Profile Targets**.

### 1. Placeholders & Macros
Use these dynamic tags inside your node templates to route data:
- `{{user_input}}`: The original text you typed into the send box.
- `{{chat_history:N}}`: The last **N** messages of the current chat (formatted as `Name: Message`).
- `{{s1}}`, `{{s2}}`: The combined output of a specific previous Step.
- `{{s1t1}}`, `{{s2t3}}`: The output of a specific individual Target Node (Step 1, Target 1).
- `{{CustomLabel}}`: Use any custom node or step label as a macro!
- `{{char}}`, `{{user}}`, `{{personality}}`, `{{description}}`, `{{scenario}}`, `{{persona}}`: Standard SillyTavern character card placeholders.
- `{{wi}}` or `{{world_info}}`: Automatically scans the chat and injects relevant Lorebook (World Info) entries.

### 2. Output Formatting
- **Persist Output**: When checked, the results of that step are written to the chat.
- **Clean Mode**: When checked along with Persist, the output is injected as a **standard character message** (using the active character's name and avatar) instead of a System Note. This is ideal for final responses.
- **System Prompt Toggle (Sys)**: Toggle whether a specific node should include the full SillyTavern System Prompt and Character Definition, or just the raw template text.

### 3. Engine Controls
- **Request Delay (ms)**: Pause between individual API calls to respect rate limits.
- **Model Timeout (ms)**: How long to wait for a slow model before giving up.
- **Max Retries**: If a model fails or returns empty, Polyceph will automatically attempt the request again.

### 4. Native Swipe Integration
Polyceph hooks directly into SillyTavern's **Swipe Right** button. 
- Swiping a Polyceph-generated message will **rerun the entire original pipeline batch**.
- All messages associated with that specific generation run will update their swipe counters (e.g., `2/2`) and refresh in unison.

### 5. Template-Only Nodes
Select `(Template Only - No LLM)` as a profile to perform pure text manipulation. This is useful for combining the outputs of multiple previous steps into a single block without calling an external API.
