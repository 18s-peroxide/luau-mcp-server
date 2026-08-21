import express from "express";
import { Mistral } from "@mistralai/mistralai";

const app = express();
app.use(express.json());

// Initialize Mistral Client
const mistral = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY || "YOUR_MISTRAL_API_KEY"
});

let pendingTask = null;
let taskResults = {};

// Delta polling & result routes
app.get("/delta/poll", (req, res) => {
    if (pendingTask) {
        const task = pendingTask;
        pendingTask = null;
        return res.json(task);
    }
    res.json({ id: null });
});

app.post("/delta/result", (req, res) => {
    const { id, result, error } = req.body;
    taskResults[id] = { result, error };
    res.json({ status: "ok" });
});

// Helper to execute tasks on Delta
async function dispatchToDelta(payload) {
    const id = Date.now().toString();
    pendingTask = { id, ...payload };

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve({ error: "Delta timed out responding." });
        }, 12000);

        const interval = setInterval(() => {
            if (taskResults[id]) {
                const res = taskResults[id];
                delete taskResults[id];
                clearInterval(interval);
                clearTimeout(timeout);
                resolve(res);
            }
        }, 200);
    });
}

// Define Mistral Function Tools
const tools = [
    {
        type: "function",
        function: {
            name: "get_game_hierarchy",
            description: "Inspect live Roblox game tree structure (Workspace, ReplicatedStorage, etc.)",
            parameters: {
                type: "object",
                properties: {
                    root: { type: "string", description: "Service name like Workspace or ReplicatedStorage" },
                    depth: { type: "number", description: "Depth of tree traversal (1-3)" }
                },
                required: ["root"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "read_script_source",
            description: "Decompile or get script source code inside a specific path",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Full instance path like game.ReplicatedStorage.Module" }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "run_luau_code",
            description: "Execute arbitrary Luau code inside Delta",
            parameters: {
                type: "object",
                properties: {
                    code: { type: "string", description: "Luau code to run" }
                },
                required: ["code"]
            }
        }
    }
];

let chatHistory = [
    { role: "system", content: "You are an expert Luau assistant connected directly to a live Roblox game running Delta on iOS. Use your tools to inspect game instances, read code, or execute scripts when requested." }
];

app.post("/chat", async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "No message provided." });

    chatHistory.push({ role: "user", content: message });

    try {
        let response = await mistral.chat.complete({
            model: process.env.MISTRAL_MODEL || "mistral-large-latest",
            messages: chatHistory,
            tools: tools
        });

        let choice = response.choices[0];
        let responseMessage = choice.message;

        // Loop through tool calls requested by Mistral
        while (responseMessage.toolCalls && responseMessage.toolCalls.length > 0) {
            chatHistory.push(responseMessage);

            for (const toolCall of responseMessage.toolCalls) {
                const name = toolCall.function.name;
                const args = typeof toolCall.function.arguments === "string" 
                    ? JSON.parse(toolCall.function.arguments) 
                    : toolCall.function.arguments;
                
                let deltaResult;

                if (name === "get_game_hierarchy") {
                    deltaResult = await dispatchToDelta({ action: "get_hierarchy", root: args.root, depth: args.depth || 2 });
                } else if (name === "read_script_source") {
                    deltaResult = await dispatchToDelta({ action: "read_script", path: args.path });
                } else if (name === "run_luau_code") {
                    deltaResult = await dispatchToDelta({ action: "execute", code: args.code });
                }

                chatHistory.push({
                    role: "tool",
                    toolCallId: toolCall.id,
                    name: name,
                    content: JSON.stringify(deltaResult)
                });
            }

            // Get next reply from Mistral with returned tool data
            response = await mistral.chat.complete({
                model: process.env.MISTRAL_MODEL || "mistral-large-latest",
                messages: chatHistory,
                tools: tools
            });
            responseMessage = response.choices[0].message;
        }

        chatHistory.push(responseMessage);
        res.json({ reply: responseMessage.content });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Mobile Chat Interface
app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Luau Mistral Agent</title>
            <style>
                body { font-family: -apple-system, sans-serif; background: #121212; color: #fff; margin: 0; padding: 15px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
                #chat { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; }
                .msg { padding: 10px 14px; border-radius: 12px; max-width: 80%; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
                .user { background: #ff7000; align-self: flex-end; }
                .ai { background: #262628; align-self: flex-start; }
                #input-area { display: flex; gap: 8px; padding-top: 10px; }
                input { flex: 1; padding: 12px; border-radius: 8px; border: 1px solid #333; background: #1c1c1e; color: #fff; font-size: 16px; }
                button { padding: 12px 18px; border-radius: 8px; border: none; background: #ff7000; color: #fff; font-weight: bold; font-size: 16px; }
            </style>
        </head>
        <body>
            <h3 style="margin: 0 0 10px 0;">Mistral Luau Agent</h3>
            <div id="chat"></div>
            <div id="input-area">
                <input id="input" placeholder="Ask Mistral to run code or inspect..." />
                <button onclick="send()">Send</button>
            </div>
            <script>
                async function send() {
                    const input = document.getElementById('input');
                    const text = input.value.trim();
                    if (!text) return;

                    appendMsg(text, 'user');
                    input.value = '';

                    const res = await fetch('/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: text })
                    });
                    const data = await res.json();
                    appendMsg(data.reply || data.error, 'ai');
                }

                function appendMsg(text, sender) {
                    const chat = document.getElementById('chat');
                    const div = document.createElement('div');
                    div.className = 'msg ' + sender;
                    div.innerText = text;
                    chat.appendChild(div);
                    chat.scrollTop = chat.scrollHeight;
                }
            </script>
        </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mistral Relay Server running on port ${PORT}`));
