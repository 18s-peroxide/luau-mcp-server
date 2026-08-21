import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";

const app = express();
app.use(express.json());

let pendingTask = null;
let taskResults = {};

// Delta polling endpoint
app.get("/delta/poll", (req, res) => {
    if (pendingTask) {
        const task = pendingTask;
        pendingTask = null;
        return res.json(task);
    }
    res.json({ id: null });
});

// Delta result posting endpoint
app.post("/delta/result", (req, res) => {
    const { id, result, error } = req.body;
    taskResults[id] = { result, error };
    res.json({ status: "ok" });
});

// Webhook endpoint for mobile AI triggering
app.post("/ai/execute", async (req, res) => {
    const { action, root, path, code } = req.body;
    const id = Date.now().toString();
    pendingTask = { id, action, root, path, code };

    const timeout = setTimeout(() => {
        res.status(504).json({ error: "Delta client timed out." });
    }, 12000);

    const interval = setInterval(() => {
        if (taskResults[id]) {
            const data = taskResults[id];
            delete taskResults[id];
            clearInterval(interval);
            clearTimeout(timeout);
            res.json(data);
        }
    }, 200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Relay] Server live on port ${PORT}`));
