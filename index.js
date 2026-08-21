import express from "express";
import { Mistral } from "@mistralai/mistralai";

const app = express();
app.use(express.json({ limit: '10mb' })); // Higher limit for large game structures

const apiKey = process.env.MISTRAL_API_KEY;
const mistral = new Mistral({ apiKey: apiKey || "" });

app.post("/chat", async (req, res) => {
    try {
        const { message, gameContext } = req.body;
        if (!message) return res.status(400).json({ error: "No message provided." });

        if (!process.env.MISTRAL_API_KEY) {
            return res.status(500).json({ reply: "Server Error: Missing MISTRAL_API_KEY on Render." });
        }

        // Build system prompt with active game context if available
        let systemContent = "You are an expert Luau assistant executing directly inside a live Roblox game through Delta Executor.";
        
        if (gameContext) {
            systemContent += `\n\n[LIVE GAME CONTEXT / WORKSPACE DATA]:\n${JSON.stringify(gameContext, null, 2)}\n\nAnalyze this data directly to answer questions about the game world. Do NOT tell the user to run code if the data is already above.`;
        }

        const messages = [
            { role: "system", content: systemContent },
            { role: "user", content: message }
        ];

        const response = await mistral.chat.complete({
            model: process.env.MISTRAL_MODEL || "mistral-large-latest",
            messages: messages
        });

        const replyContent = response.choices?.[0]?.message?.content || "No response.";
        res.json({ reply: replyContent });

    } catch (err) {
        console.error("BACKEND ERROR:", err);
        res.status(500).json({ reply: `Server Error: ${err.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
