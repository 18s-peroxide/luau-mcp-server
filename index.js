import express from "express";
import { Mistral } from "@mistralai/mistralai";

const app = express();
app.use(express.json());

// Load global configuration variables
const CONFIG = {
    systemPrompt: "You are an expert Luau assistant connected directly to a live Roblox game running Delta on iOS. Use your tools to inspect game instances, read code, or execute scripts when requested.",
    defaultModel: process.env.MISTRAL_MODEL || "mistral-large-latest",
    maxTreeDepth: 2,
    timeoutMs: 12000
};

// Global chat history state
let chatHistory = [
    { role: "system", content: CONFIG.systemPrompt }
];

// Initialize Mistral using the environment variable set in Render
const mistral = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY
});

// Helper for Delta bridge requests
async function dispatchToDelta(payload) {
    console.log("Sending command to Delta:", payload);
    return { status: "success", data: `Executed ${payload.action} successfully.` };
}

// Function tools provided to Mistral
const tools = [
    {
        type: "function",
        function: {
            name: "get_game_hierarchy",
            description: "Fetches the instance tree hierarchy from the active Roblox game session.",
            parameters: {
                type: "object",
                properties: {
                    root: { type: "string", description: "The starting path (e.g., 'Game.Workspace')" },
                    depth: { type: "number", description: "Depth of children to traverse" }
                },
                required: ["root"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "read_script_source",
            description: "Retrieves the source code of a specified script instance path.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Full hierarchy path to the script" }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "run_luau_code",
            description: "Executes raw Luau script directly inside the Delta environment.",
            parameters: {
                type: "object",
                properties: {
                    code: { type: "string", description: "Luau code string to run" }
                },
                required: ["code"]
            }
        }
    }
];

// Chat endpoint
app.post("/chat", async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "No message provided." });

    chatHistory.push({ role: "user", content: message });

    try {
        let response = await mistral.chat.complete({
            model: CONFIG.defaultModel,
            messages: chatHistory,
            tools: tools
        });

        let choice = response.choices[0];
        let responseMessage = choice.message;

        // Process function calls if triggered by Mistral
        while (responseMessage.toolCalls && responseMessage.toolCalls.length > 0) {
            chatHistory.push(responseMessage);

            for (const toolCall of responseMessage.toolCalls) {
                const name = toolCall.function.name;
                const args = typeof toolCall.function.arguments === "string" 
                    ? JSON.parse(toolCall.function.arguments) 
                    : toolCall.function.arguments;
                
                let deltaResult;

                if (name === "get_game_hierarchy") {
                    deltaResult = await dispatchToDelta({ 
                        action: "get_hierarchy", 
                        root: args.root, 
                        depth: args.depth || CONFIG.maxTreeDepth 
                    });
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

            response = await mistral.chat.complete({
                model: CONFIG.defaultModel,
                messages: chatHistory,
                tools: tools
            });
            responseMessage = response.choices[0].message;
        }

        chatHistory.push(responseMessage);
        res.json({ reply: responseMessage.content });
    } catch (err) {
        console.error("Error handling chat request:", err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
