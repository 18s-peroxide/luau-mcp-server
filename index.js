import express from "express";
import { Mistral } from "@mistralai/mistralai";

const app = express();
app.use(express.json());

// Initialize Mistral Client
const apiKey = process.env.MISTRAL_API_KEY;
if (!apiKey) {
    console.error("CRITICAL WARNING: MISTRAL_API_KEY environment variable is missing!");
}

const mistral = new Mistral({
    apiKey: apiKey || ""
});

// Basic System Prompt
const SYSTEM_PROMPT = "You are an expert Luau assistant for Roblox. Help the user write, debug, and understand scripts.";

// Simple In-Memory Conversation History
let chatHistory = [
    { role: "system", content: SYSTEM_PROMPT }
];

app.post("/chat", async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: "No message provided." });
        }

        // Check key presence before sending request
        if (!process.env.MISTRAL_API_KEY) {
            console.error("Error: MISTRAL_API_KEY is not set in environment variables.");
            return res.status(500).json({ 
                reply: "Server Error: MISTRAL_API_KEY is missing in Render Environment settings." 
            });
        }

        chatHistory.push({ role: "user", content: message });

        // Simple completion without complex tool loop crashes
        const response = await mistral.chat.complete({
            model: process.env.MISTRAL_MODEL || "mistral-large-latest",
            messages: chatHistory
        });

        const replyContent = response.choices?.[0]?.message?.content || "No response received from Mistral.";

        // Save AI response to history
        chatHistory.push({ role: "assistant", content: replyContent });

        res.json({ reply: replyContent });

    } catch (err) {
        console.error("FULL BACKEND ERROR LOG:", err);
        res.status(500).json({ 
            reply: `Server Internal Error: ${err.message || "Unknown error occurred."}` 
        });
    }
});

app.get("/", (req, res) => {
    res.send("Mistral Proxy Server is online.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
