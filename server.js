/* server.js (Render-ready) */
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || "replace_with_your_secret";
const MESSAGES_FILE = path.join(process.cwd(), "messages_queue.json");

let firebaseAdmin = null;
let dbRef = null;

function makeId() { return Date.now().toString(36) + "-" + Math.floor(Math.random()*100000).toString(36); }
function ensureMessagesFile() { if (!fs.existsSync(MESSAGES_FILE)) { fs.writeFileSync(MESSAGES_FILE, JSON.stringify([], null, 2), "utf8"); } }
function pushLocalQueue(obj) { ensureMessagesFile(); $([System.Text.RegularExpressions.Regex]::Escape("")); var arr = JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf8") || "[]"); arr.push(obj); fs.writeFileSync(MESSAGES_FILE, JSON.stringify(arr, null, 2), "utf8"); }

async function tryInitFirebaseFromEnv() {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT || "";
  const dbUrl = process.env.FIREBASE_DB_URL || "";
  if (!saJson || !dbUrl) {
    console.log("Firebase not configured via env; running in local-file mode.");
    return false;
  }
  try {
    const admin = require("firebase-admin");
    const serviceAccount = JSON.parse(saJson);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: dbUrl
    });
    firebaseAdmin = admin;
    dbRef = firebaseAdmin.database().ref("/messages");
    console.log("Initialized Firebase RTDB (env).");
    return true;
  } catch (err) {
    console.warn("Failed to init firebase-admin from env:", err.message);
    firebaseAdmin = null;
    dbRef = null;
    return false;
  }
}

const app = express();
app.use(bodyParser.json({ limit: "200kb" }));

app.post("/sheetsToFirebase", async (req, res) => {
  try {
    const secret = req.get("x-bridge-secret") || (req.body && req.body.secret);
    if (!secret || secret !== BRIDGE_SECRET) return res.status(403).json({ ok: false, error: "Forbidden - bad secret" });

    const payload = req.body || {};
    if (!payload.port || !payload.message) return res.status(400).json({ ok: false, error: "Require port and message" });

    const record = {
      id: makeId(),
      port: String(payload.port).trim(),
      message: String(payload.message),
      schedule_time: payload.schedule_time || "",
      status: payload.status || "pending",
      created_at: new Date().toISOString(),
      sheet_meta: payload.sheet_meta || null
    };

    if (dbRef) {
      const ref = await dbRef.push();
      await ref.set(record);
      return res.json({ ok: true, id: ref.key, mode: "firebase" });
    }

    pushLocalQueue(record);
    return res.json({ ok: true, id: record.id, mode: "local-file", file: MESSAGES_FILE });

  } catch (err) {
    console.error("Server error", err);
    return res.status(500).json({ ok: false, error: "server error" });
  }
});

app.get("/ping", (req, res) => res.json({ ok: true, now: new Date().toISOString() }));

(async () => {
  await tryInitFirebaseFromEnv();
  ensureMessagesFile();
  app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}. POST /sheetsToFirebase`);
  });
})();
