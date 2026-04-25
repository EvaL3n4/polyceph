# Polyceph

A multi-model orchestration extension for SillyTavern. Define complex, user-governed reasoning pipelines that allow a single user message to trigger a multi-step, multi-connection response generation process.

## The Problem

Standard AI interaction is linear: you send a prompt, and a single model responds. This limits you to the strengths (and weaknesses) of a single API connection:
- You can't have a smarter model "plan" a response before a creative model writes it, or a more attentive model gather information before a smarter model considers the implications.
- You can't cross-reference multiple models to reduce hallucinations or "consensus" check.
- You can't perform intermediate summaries or data extraction during the generation flow.

## The Solution

**Polyceph** (meaning "many-headed") allows you to construct **Pipelines**. A single message from you can trigger an asynchronous, multi-step series of tasks. Models can critique their own work, summarize chat history, or anything you can write a prompt for - delivering responses into your chat at any point you choose during the reasoning chain. You can also create multiple pipelines, easily switching between them to use the best one for your message.

## Features

- **Multi-Step Pipelines**: Chain multiple LLM calls and output collection templates together in sequential steps.
- **Parallel Tasking**: Run multiple models simultaneously within a single step to gather diverse perspectives.
- **In-Chat Selector**: Switch between logic pipelines or bypass Polyceph entirely directly from the chat input bar.
- **Custom Macros**: Use the output of any previous step or task in subsequent prompts using `{{handlebars}}` placeholders/macros.
- **Silent Reasoning**: Optionally show pipeline tasks blocks in a dedicated, collapsible "Reasoning" UI element.
- **Native Swipe Support**: Swiping a Polyceph message reruns the entire pipeline batch, keeping all multi-step results in sync.

## Installation

### Via SillyTavern Extension Installer (Recommended)

1. Open SillyTavern.
2. Go to **Extensions** (puzzle icon) → **Install Extension**.
3. Paste this repository URL: `https://github.com/nialyn-mid/polyceph`
4. Click **Install**.
5. Refresh the page.

### Manual Installation

1. Navigate to your SillyTavern installation's `public/scripts/extensions` folder.
2. Clone this repository or download the ZIP into a folder named `polyceph`.
3. Restart SillyTavern or refresh your browser.

## Setup Guide

### Step 1: Configure Connection Profiles
Polyceph leverages SillyTavern's built-in **Connection Profiles**. 
1. Open the **API Connections** menu (plug icon).
2. Configure a model and click **Save** in the Connection Profiles section.
3. Repeat for each model you want to use in your pipelines.

### Step 2: Build a Pipeline
1. Open the **Extensions** menu (puzzle icon) and select **Polyceph**.
2. Create a new Pipeline and add **Steps**.
3. Add **Tasks** to each step. Assign a **Connection Profile** and write a **Prompt Template** for each task.
4. Choose options such as "Reasoning" to show the user the prompt response as reasoning, or "Character Message" to display the result as the character.

### Step 3: Use in Chat
1. Locate the **Pipeline Selector** (☍ icon) next to the chat send button.
2. Select your desired pipeline (or "None" to chat normally).
3. Type a message and hit send!

## Macro & Placeholder Reference

Route data between tasks using these handlebars placeholders/macros:
- `{{user_input}}`: The original text from the chat box.
- `{{chat_history|last:10|bg_last:2|live:true}}`: Advanced history filtering.
    - `last:N`: Limit total messages to N.
    - `bg_last:N`: Keep only the last N background messages (interspersed).
    - `live:true`: Use real-time chat (includes earlier pipeline results).
- `{{s1}}`, `{{s2}}`: The combined output of all tasks in a previous Step.
- `{{TaskLabel}}`: The output of a specific task (uses the custom label you assigned to the task).
- `{{system_prompt}}`: The **Main Prompt** text from SillyTavern's Advanced Formatting settings.
- `{{char}}`, `{{user}}`, `{{persona}}`, `{{personality}}`, etc.: All standard SillyTavern macros.
- `{{wi}}` or `{{world_info}}`: Automatically scans chat context and injects relevant Lorebook entries.
- `{{polyceph_prompt}}`: The global Polyceph Prompt defined in extension settings. Evaluated **recursively** (can contain other placeholders).
- `{{cc_main_prompt}}`, `{{cc_aux_prompt}}`: Specific Chat Completion prompts.
- `{{cc_post_history_instructions}}`, `{{cc_enhance_definitions}}`: Other individual CC prompts.
- `{{cc_all_prompts}}`: **Comprehensive Context**. Rebuilds the *entire* SillyTavern prompt list exactly as configured in your settings. Resolves all enabled markers (Description, Personality, World Info, History, Examples) in their correct order.


## Postprocessing Tags

Polyceph automatically parses and processes specific tags in LLM outputs to manage context and chat history:

| Tag | Passed to Next Step? | Persisted to Chat? | Visible to User? |
|-----|----------------------|-------------------|------------------|
| `<think>` | **No** | **No** | Yes (Reasoning UI) |
| `<ramble>` | **Yes** | **No** | Yes (Reasoning UI) |
| `<background>` | **Yes** | **Yes** (Hidden) | Toggleable (Separator) |

- **`<think>`**: Traditional reasoning/CoT. It is stripped from the text passed to later steps to save tokens, but displayed in the collapsible reasoning block at the top of the message.
- **`<ramble>`**: Internal monologues or planning data you want the next step to have access to. Useful for passing information between pipeline steps that you *don't* want to save in the permanent chat history.
- **`<background>`**: "hidden" output which is saved in the chat history as a hidden system message. Future chat turns will "remember" this information, but it remains invisible to you unless the **"Show Hidden Background Messages"** setting is enabled. Useful for having characters continue to act or react outside of the user's perception.

## Task Options

| Option | Description |
|--------|-------------|
| **Reasoning** | Posts the task result to chat as a reasoning block. |
| **Character Message** | Posts the result using the character's name and avatar (ideal for final responses). |

## API Compatibility

Polyceph is designed to be a transparent layer on top of SillyTavern's existing generation infrastructure. It does **not** maintain its own sampler settings, API keys, or model configurations. Instead, it delegates all generation to SillyTavern's native `generateRaw()` function, which guarantees that every Polyceph task respects your currently active preset exactly as if you had typed the message yourself.

### How Prompt Building Works

When a pipeline task is executed, Polyceph performs the following steps:

1.  **Macro Expansion** (`js/macros.js`): The task's prompt template is resolved. All `{{handlebars}}` placeholders — including `{{chat_history}}`, `{{cc_all_prompts}}`, `{{wi}}`, and standard SillyTavern macros like `{{char}}` — are expanded into their final text. For Chat Completion macros like `{{cc_all_prompts}}`, Polyceph reads the active **Prompt Manager** order and resolves each enabled prompt (Main, Persona Description, Character Description, etc.) in the exact sequence configured in your Chat Completion settings.

2.  **Role Tagging** (`js/engine.js`): The expanded prompt is parsed for `[[ROLE:system]]`, `[[ROLE:user]]`, and `[[ROLE:assistant]]` tags. These are converted into a structured message array (`[{role, content}, ...]`) that Chat Completion APIs expect. If no role tags are present, the entire prompt is sent as a single `system` message. The parser validates tag structure and warns in the console if:
    -   Content exists outside role tags (will be sent as an implicit `system` message).
    -   Opening and closing tag counts don't match (possible malformed template).

3.  **Token Budget Check** (`js/compat-shared.js`): Before sending, Polyceph checks the prompt's token count against the active context window. It reads the live context limit from `oai_settings.openai_max_context` (for Chat Completion) or the global `max_context` (for Text Completion) and warns in the console if the prompt exceeds the available budget after reserving space for the response.

4.  **Native Generation** via `generateRaw()`: The structured message array is passed to SillyTavern's `generateRaw()`. This is the same function that powers SillyTavern's own `/gen` slash command. Internally, it dispatches to the active backend:
    -   **Chat Completion** → `sendOpenAIRequest()` → `createGenerationParameters()` — applies temperature, top_p, frequency/presence penalties, logit bias, stop strings, reasoning effort, and all other settings from the active Chat Completion preset.
    -   **Text Completion** → `getTextGenGenerationData()` → `createTextGenGenerationData()` — applies temperature, top_k, rep_pen, mirostat, banned tokens, instruct mode formatting, and all other settings from the active Text Completion preset.
    -   **Instruct Formatting** → `createRawPrompt()` — automatically wraps text prompts in the active Instruct Template (Alpaca, ChatML, etc.) when using Text Completion APIs with Instruct Mode enabled.
    -   **Stopping Strings** — SillyTavern passes your custom and instruct-mode stopping strings directly to the API as part of the generation request. The API provider handles stopping natively, ensuring clean output without post-processing truncation.

### What This Means

-   **Switching your Chat Completion preset** (e.g. changing temperature from 1.0 to 0.7) immediately affects all subsequent Polyceph tasks — no restart or reconfiguration needed.
-   **Logit bias**, **banned tokens**, **grammar constraints**, and **JSON schema** settings from your active preset are all honored automatically.
-   **Instruct mode** templates are applied identically to how SillyTavern would format a normal chat message.
-   Polyceph's compatibility layer (`js/compat-shared.js`, `js/compat-chat.js`, `js/compat-text.js`) only reads settings for its own decision-making (token budgeting, feature flag checks) — it never overrides or duplicates SillyTavern's generation logic.


## Engine Controls

- **Request Delay**: Pause between API calls to avoid rate limits.
- **Max Retries**: Automatically retry failed or empty model responses.
- **Timeout**: Prevents the pipeline from hanging on slow or stuck connections.
