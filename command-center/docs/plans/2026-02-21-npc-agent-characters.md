# NPC Agent Characters Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn configured agents into walkable NPC characters in the game world with inline speech-bubble chat that expands to a side panel.

**Architecture:** Read agents from `/api/agents` (agents.json), spawn each as an NPC at a position near their related station. NPCs render as emoji + glow avatar on canvas. Walking up and pressing E opens an inline speech bubble chat; long conversations expand to a slim side panel. Existing stations remain as infrastructure.

**Tech Stack:** Vanilla JS, Canvas 2D, existing `h()` helper for DOM, existing `/api/agent/message` API.

**File to modify:** `command-center/index.html` (only file — all HTML/CSS/JS inline)

---

## Reference: Current Codebase Layout

**Station positions** (for NPC placement near related stations):
- Comms Hub: cx=1200, cy=190
- Sessions: cx=370, cy=500
- Gateway Core: cx=1200, cy=700 (center of map)
- Cron Scheduler: cx=2030, cy=500
- Agent Bay: cx=370, cy=1100
- Log Console: cx=1200, cy=1300
- Skills Library: cx=2030, cy=1100

**agents.json agents and their related stations:**
- JARVIS (Chief Coordinator) → Gateway Core (center)
- COACH (Daily Motivation) → Cron Scheduler (uses morning/evening cron)
- BUDGET (Financial Tracker) → Cron Scheduler area
- HUNTER (Apartment Scout) → Cron Scheduler area
- SCOUT (Event Radar) → Comms Hub (sends digests)
- LENDER (Ticket Manager) → Agent Bay (pending setup)

**Key existing functions to understand:**
- `renderStations(ctx)` at line ~2752 — draws all station boxes on canvas
- `renderPlayer(ctx, px, py)` at line ~3234 — draws player diamond
- `checkCollision(px, py)` at line ~2544 — wall + station collision
- `updateNearestStation()` at line ~2564 — proximity detection for interact prompt
- `openChat(sessionId, sessionKey, model)` at line ~2188 — opens right-side chat panel
- `sendChatMessage()` at line ~2218 — sends message via `/api/agent/message`
- `extractAgentResponse(data)` at line ~2267 — extracts text from API response
- `getStationAtScreen(sx, sy)` at line ~3613 — mouse hit-testing for stations

**Code conventions (MUST preserve):**
- `var` declarations (no let/const)
- `function` keyword (no arrows)
- `// ═══` section separators
- `h(tag, attrs, children)` for DOM creation
- `ctx.save()`/`ctx.restore()` for canvas state
- Null-check data before access

---

## Task 1: Fix Chat Response Bug

The chat panel currently dumps raw JSON because `extractAgentResponse()` doesn't handle the `payloads` format returned by the gateway CLI. The response has `{ payloads: [{ text: "..." }], meta: {...} }`.

**Files:**
- Modify: `command-center/index.html` — `extractAgentResponse()` function at line ~2267

**Step 1: Fix extractAgentResponse to handle payloads format**

Add `data.payloads` handling as the first check in the function:

```javascript
function extractAgentResponse(data) {
  if (typeof data === 'string') return data;
  // Handle gateway CLI payloads format
  if (data.payloads && Array.isArray(data.payloads)) {
    return data.payloads
      .map(function(p) { return p.text || ''; })
      .filter(function(t) { return t; })
      .join('\n');
  }
  if (data.raw) return data.raw;
  if (data.response) return data.response;
  if (data.text) return data.text;
  if (data.content) {
    if (typeof data.content === 'string') return data.content;
    if (Array.isArray(data.content)) {
      return data.content
        .filter(function(c) { return c.type === 'text'; })
        .map(function(c) { return c.text; })
        .join('\n');
    }
  }
  if (data.result) return extractAgentResponse(data.result);
  return JSON.stringify(data, null, 2);
}
```

**Step 2: Verify**

Open browser, send a chat message, confirm response shows clean text instead of raw JSON.

**Step 3: Commit**

```bash
git add command-center/index.html
git commit -m "fix: handle payloads format in chat response extraction"
```

---

## Task 2: NPC Data Model + State

Add the NPC character array and positioning logic. NPCs are built from `agentsData` after it's fetched.

**Files:**
- Modify: `command-center/index.html` — GAME STATE section (~line 1332)

**Step 1: Add NPC state variables after existing game state**

After `var activityFeed = [];` (around line 1345), add:

```javascript
var npcCharacters = [];
var nearestNPC = null;
var activeNPCChat = null; // { npc, bubbleText, bubbleLife, expanded }
```

**Step 2: Add NPC position mapping + builder function**

Add a new section after the GAME STATE block. This maps agent IDs to positions near their related stations:

```javascript
// ═══════════════════════════════════════════
// NPC CHARACTERS
// ═══════════════════════════════════════════
var NPC_POSITIONS = {
  'jarvis': { cx: 1120, cy: 780 },   // Near Gateway Core
  'coach':  { cx: 1950, cy: 420 },   // Near Cron Scheduler
  'budget': { cx: 2110, cy: 420 },   // Near Cron Scheduler (other side)
  'hunter': { cx: 2030, cy: 620 },   // Below Cron Scheduler
  'scout':  { cx: 1110, cy: 260 },   // Near Comms Hub
  'lender': { cx: 450, cy: 1030 }    // Near Agent Bay
};

var NPC_COLORS = {
  'jarvis': '#00d4ff',
  'budget': '#fdcb6e',
  'hunter': '#00b894',
  'lender': '#a29bfe',
  'scout':  '#fd79a8',
  'coach':  '#e17055'
};

var NPC_SIZE = 24;
var NPC_INTERACT_RADIUS = 80;

function buildNPCCharacters() {
  var agents = agentsData && (agentsData.agents || agentsData);
  if (!agents) return;
  if (!Array.isArray(agents)) {
    agents = Object.keys(agents).map(function(k) {
      var a = agents[k];
      if (typeof a === 'object') { a.id = a.id || k; return a; }
      return { id: k, name: k };
    });
  }

  npcCharacters = [];
  var usedPositions = {};
  agents.forEach(function(agent) {
    var id = agent.id || agent.name || '?';
    var pos = NPC_POSITIONS[id.toLowerCase()];
    if (!pos) {
      // Fallback: place in a line below center
      var idx = npcCharacters.length;
      pos = { cx: 800 + idx * 120, cy: 900 };
    }
    npcCharacters.push({
      id: id,
      name: agent.name || id,
      role: agent.role || '',
      emoji: agent.emoji || '\u{1F916}',
      status: agent.status || 'idle',
      statusText: agent.statusText || '',
      color: NPC_COLORS[id.toLowerCase()] || '#888',
      cx: pos.cx,
      cy: pos.cy,
      sessionKey: agent.sessionKey || id,
      bobPhase: Math.random() * Math.PI * 2
    });
  });
}
```

**Step 3: Hook buildNPCCharacters into fetchAgents**

Modify `fetchAgents()` to call `buildNPCCharacters()` after data arrives:

```javascript
async function fetchAgents() {
  try {
    agentsData = await api('/api/agents');
    renderAgentsGrid();
    buildNPCCharacters();
  } catch (e) {
    // ... existing error handling
  }
}
```

**Step 4: Also call it in refreshAll so NPCs appear on first load**

In `refreshAll()`, add `fetchAgents()` to the `Promise.all` if not already there. Currently it's lazy-loaded. Change:

```javascript
await Promise.all([fetchStatus(), fetchHealth(), fetchCron(), fetchSessions(), fetchAgents()]);
```

**Step 5: Commit**

```bash
git add command-center/index.html
git commit -m "feat: add NPC character data model and position mapping"
```

---

## Task 3: Render NPC Characters on Canvas

Draw each NPC as emoji + colored glow circle with name tag and status indicator.

**Files:**
- Modify: `command-center/index.html` — add `renderNPCs(ctx)` function, call it from `render()`

**Step 1: Add renderNPCs function**

Add after the `renderStations()` function (after the closing `}`):

```javascript
// ═══════════════════════════════════════════
// NPC RENDERING
// ═══════════════════════════════════════════
function renderNPCs(ctx) {
  for (var i = 0; i < npcCharacters.length; i++) {
    var npc = npcCharacters[i];
    var isNear = nearestNPC === npc && !activeOverlay;
    var bob = Math.sin(animTimer * 1.5 + npc.bobPhase) * 3;

    ctx.save();

    // Glow circle base
    var glowGrad = ctx.createRadialGradient(npc.cx, npc.cy + bob, 0, npc.cx, npc.cy + bob, NPC_SIZE + 12);
    glowGrad.addColorStop(0, npc.color + (isNear ? '40' : '20'));
    glowGrad.addColorStop(1, npc.color + '00');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(npc.cx, npc.cy + bob, NPC_SIZE + 12, 0, Math.PI * 2);
    ctx.fill();

    // Solid circle base
    ctx.beginPath();
    ctx.arc(npc.cx, npc.cy + bob, NPC_SIZE, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(18,18,31,0.85)';
    ctx.fill();
    ctx.strokeStyle = isNear ? npc.color : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = isNear ? 2.5 : 1.5;
    ctx.stroke();

    // Emoji face
    ctx.font = '28px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(npc.emoji, npc.cx, npc.cy + bob - 2);

    // Name tag above
    ctx.font = '600 11px "SF Pro Display", -apple-system, sans-serif';
    ctx.fillStyle = isNear ? '#fff' : '#ccc';
    ctx.fillText(npc.name, npc.cx, npc.cy + bob - NPC_SIZE - 10);

    // Role below
    ctx.font = '10px "SF Pro Display", -apple-system, sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText(npc.role, npc.cx, npc.cy + bob + NPC_SIZE + 14);

    // Status dot (top-right of circle)
    var statusColor = npc.status === 'online' ? '#00ff88' : npc.status === 'scheduled' ? '#fdcb6e' : npc.status === 'idle' ? '#888' : '#ff4757';
    ctx.beginPath();
    ctx.arc(npc.cx + NPC_SIZE - 4, npc.cy + bob - NPC_SIZE + 4, 4, 0, Math.PI * 2);
    ctx.fillStyle = statusColor;
    ctx.fill();
    ctx.strokeStyle = '#12121f';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }
}
```

**Step 2: Call renderNPCs in the render function**

In `render(alpha)`, add `renderNPCs(ctx);` right after `renderStations(ctx);`:

```javascript
// Stations
renderStations(ctx);

// NPC Characters
renderNPCs(ctx);
```

**Step 3: Commit**

```bash
git add command-center/index.html
git commit -m "feat: render NPC agent characters on canvas"
```

---

## Task 4: NPC Collision + Proximity Detection

Add NPCs to collision detection so the player walks around them, and add proximity detection for the interact prompt.

**Files:**
- Modify: `command-center/index.html` — `checkCollision()`, `updateNearestStation()`, `updateHUD()`

**Step 1: Add NPC collision in checkCollision**

Inside `checkCollision(px, py)`, after the station collision loop, add:

```javascript
// NPC collisions
for (var i = 0; i < npcCharacters.length; i++) {
  var npc = npcCharacters[i];
  var ndx = px - npc.cx;
  var ndy = py - npc.cy;
  if (Math.sqrt(ndx * ndx + ndy * ndy) < NPC_SIZE + half) return true;
}
```

**Step 2: Add NPC proximity detection**

Create a new function `updateNearestNPC()` and call it from the game update loop alongside `updateNearestStation()`:

```javascript
function updateNearestNPC() {
  nearestNPC = null;
  var minDist = Infinity;
  for (var i = 0; i < npcCharacters.length; i++) {
    var npc = npcCharacters[i];
    var dx = player.x - npc.cx;
    var dy = player.y - npc.cy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < NPC_INTERACT_RADIUS && dist < minDist) {
      minDist = dist;
      nearestNPC = npc;
    }
  }
}
```

In `update(dt)`, add `updateNearestNPC();` right after `updateNearestStation();`.

**Step 3: Update HUD prompt to show NPC info**

In `updateHUD()`, add NPC handling. NPC takes priority over station if both are near:

```javascript
function updateHUD() {
  var prompt = document.getElementById('interactPrompt');
  if (nearestNPC && !activeOverlay && !activeNPCChat) {
    prompt.textContent = 'Press E \u2014 Talk to ' + nearestNPC.emoji + ' ' + nearestNPC.name;
    prompt.style.whiteSpace = 'pre-line';
    prompt.style.borderColor = nearestNPC.color;
    prompt.style.borderWidth = '1.5px';
    prompt.classList.add('visible');
  } else if (nearestStation && !activeOverlay && !nearestNPC) {
    var stats = getStationQuickStats(nearestStation);
    var lines = 'Press E \u2014 ' + nearestStation.emoji + ' ' + nearestStation.label;
    if (stats) lines += '\n' + stats;
    prompt.textContent = lines;
    prompt.style.whiteSpace = 'pre-line';
    prompt.style.borderColor = nearestStation.colorPrimary;
    prompt.style.borderWidth = '1.5px';
    prompt.classList.add('visible');
  } else if (!activeOverlay) {
    prompt.classList.remove('visible');
    prompt.style.borderColor = '';
    prompt.style.borderWidth = '';
  }
}
```

**Step 4: Update mouse click handler to support NPC clicks**

In the canvas click handler, add NPC hit-testing. Add a helper first:

```javascript
function getNPCAtScreen(sx, sy) {
  var wx = sx + camera.x;
  var wy = sy + camera.y;
  for (var i = 0; i < npcCharacters.length; i++) {
    var npc = npcCharacters[i];
    var dx = wx - npc.cx;
    var dy = wy - npc.cy;
    if (Math.sqrt(dx * dx + dy * dy) < NPC_SIZE + 8) return npc;
  }
  return null;
}
```

Update the canvas click handler to check NPCs first:

```javascript
canvas.addEventListener('click', function(e) {
  if (activeOverlay) return;
  var rect = canvas.getBoundingClientRect();
  var sx = e.clientX - rect.left;
  var sy = e.clientY - rect.top;
  // NPCs take priority
  var npcHit = getNPCAtScreen(sx, sy);
  if (npcHit) {
    openNPCChat(npcHit);
    return;
  }
  var hit = getStationAtScreen(sx, sy);
  if (hit) {
    openOverlay(hit.id);
  }
});
```

Update the mousemove handler to also check NPCs for cursor and tooltip.

**Step 5: Update E-key handler**

In the keydown handler, update the E key section to handle NPC interaction:

```javascript
if ((key === 'e' || key === 'enter') && !activeOverlay) {
  if (nearestNPC) {
    e.preventDefault();
    openNPCChat(nearestNPC);
  } else if (nearestStation) {
    e.preventDefault();
    openOverlay(nearestStation.id);
  }
}
```

**Step 6: Commit**

```bash
git add command-center/index.html
git commit -m "feat: add NPC collision, proximity detection, and interaction"
```

---

## Task 5: Speech Bubble Chat System

The core chat UX: inline speech bubbles above NPCs on the canvas, with a minimal text input at the bottom.

**Files:**
- Modify: `command-center/index.html` — CSS, HTML, and JS

**Step 1: Add CSS for speech bubble input bar and bubble**

In the `<style>` section, add:

```css
/* ── NPC Speech Bubble Input ── */
.npc-chat-bar {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: none;
  align-items: center;
  gap: 10px;
  z-index: 200;
  background: rgba(12,12,20,0.9);
  backdrop-filter: blur(8px);
  border-radius: 14px;
  padding: 8px 12px;
  border: 1.5px solid rgba(255,255,255,0.12);
  width: 480px;
  max-width: 90vw;
}

.npc-chat-bar.active { display: flex; }

.npc-chat-bar .npc-chat-label {
  font-size: 0.75rem;
  color: #888;
  white-space: nowrap;
  flex-shrink: 0;
}

.npc-chat-bar input {
  flex: 1;
  background: transparent;
  border: none;
  color: #e0e0e0;
  font-size: 0.85rem;
  font-family: inherit;
  outline: none;
  padding: 4px 0;
}

.npc-chat-bar .npc-send-btn {
  background: linear-gradient(135deg, #00d4ff, #7b2cbf);
  border: none;
  color: #fff;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  flex-shrink: 0;
}

.npc-chat-bar .npc-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.npc-chat-bar .npc-expand-btn {
  background: none;
  border: 1px solid rgba(255,255,255,0.15);
  color: #888;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.7rem;
  flex-shrink: 0;
}

.npc-chat-bar .npc-expand-btn:hover { color: #fff; border-color: rgba(255,255,255,0.3); }
```

**Step 2: Add HTML for the chat input bar**

Before the `<div class="toast">` element, add:

```html
<div class="npc-chat-bar" id="npcChatBar">
  <span class="npc-chat-label" id="npcChatLabel">JARVIS:</span>
  <input type="text" id="npcChatInput" placeholder="Say something...">
  <button class="npc-send-btn" id="npcSendBtn">Send</button>
  <button class="npc-expand-btn" id="npcExpandBtn" title="Expand to panel">&#x2197;</button>
</div>
```

**Step 3: Add speech bubble rendering on canvas**

Speech bubbles are stored per-NPC as `{ text, life, alpha }`. Add a `renderSpeechBubbles(ctx)` function near the NPC rendering code:

```javascript
// ═══════════════════════════════════════════
// SPEECH BUBBLES
// ═══════════════════════════════════════════
var speechBubbles = []; // { npcId, text, life, x, y }

function addSpeechBubble(npcId, text, duration) {
  // Remove existing bubble for this NPC
  speechBubbles = speechBubbles.filter(function(b) { return b.npcId !== npcId; });
  var npc = npcCharacters.find(function(n) { return n.id === npcId; });
  if (!npc) return;
  speechBubbles.push({
    npcId: npcId,
    text: text.length > 180 ? text.substring(0, 177) + '...' : text,
    fullText: text,
    life: duration || 8,
    maxLife: duration || 8,
    x: npc.cx,
    y: npc.cy - NPC_SIZE - 30
  });
}

function updateSpeechBubbles(dt) {
  for (var i = speechBubbles.length - 1; i >= 0; i--) {
    speechBubbles[i].life -= dt;
    if (speechBubbles[i].life <= 0) speechBubbles.splice(i, 1);
  }
}

function renderSpeechBubbles(ctx) {
  ctx.save();
  for (var i = 0; i < speechBubbles.length; i++) {
    var b = speechBubbles[i];
    var alpha = Math.min(1, b.life / 1.0); // Fade in last second
    if (b.life > b.maxLife - 0.3) alpha = (b.maxLife - b.life) / 0.3; // Fade in first 0.3s

    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = '12px "SF Pro Display", -apple-system, sans-serif';

    // Word wrap
    var maxWidth = 220;
    var words = b.text.split(' ');
    var lines = [];
    var currentLine = '';
    for (var w = 0; w < words.length; w++) {
      var testLine = currentLine ? currentLine + ' ' + words[w] : words[w];
      if (ctx.measureText(testLine).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = words[w];
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    var lineHeight = 16;
    var padding = 10;
    var bubbleW = Math.min(maxWidth + padding * 2, 250);
    var bubbleH = lines.length * lineHeight + padding * 2;
    var bx = b.x - bubbleW / 2;
    var by = b.y - bubbleH;

    // Bubble background
    roundRect(ctx, bx, by, bubbleW, bubbleH, 10);
    ctx.fillStyle = 'rgba(18,18,31,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Triangle pointer
    ctx.beginPath();
    ctx.moveTo(b.x - 6, by + bubbleH);
    ctx.lineTo(b.x, by + bubbleH + 8);
    ctx.lineTo(b.x + 6, by + bubbleH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(18,18,31,0.92)';
    ctx.fill();

    // Text
    ctx.fillStyle = '#e0e0e0';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (var l = 0; l < lines.length; l++) {
      ctx.fillText(lines[l], bx + padding, by + padding + l * lineHeight);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
```

**Step 4: Add openNPCChat and sendNPCMessage functions**

```javascript
function openNPCChat(npc) {
  activeNPCChat = { npc: npc, expanded: false };
  var bar = document.getElementById('npcChatBar');
  var label = document.getElementById('npcChatLabel');
  var input = document.getElementById('npcChatInput');
  label.textContent = npc.emoji + ' ' + npc.name + ':';
  label.style.color = npc.color;
  bar.style.borderColor = npc.color + '40';
  bar.classList.add('active');
  input.value = '';
  input.focus();
}

function closeNPCChat() {
  activeNPCChat = null;
  document.getElementById('npcChatBar').classList.remove('active');
}

async function sendNPCMessage() {
  if (!activeNPCChat) return;
  var input = document.getElementById('npcChatInput');
  var msg = input.value.trim();
  if (!msg) return;

  var npc = activeNPCChat.npc;
  var sendBtn = document.getElementById('npcSendBtn');
  sendBtn.disabled = true;
  input.value = '';

  // Show user message as brief bubble
  addSpeechBubble(npc.id + '_user', msg, 3);
  // Position user bubble slightly to the right
  var userBubble = speechBubbles.find(function(b) { return b.npcId === npc.id + '_user'; });
  if (userBubble) {
    userBubble.x = npc.cx + 30;
    userBubble.y = npc.cy - NPC_SIZE - 60;
  }

  // Find session for this agent
  var sessionId = null;
  if (sessionsData && sessionsData.sessions) {
    var match = sessionsData.sessions.find(function(s) {
      return s.key && s.key.indexOf(':' + npc.sessionKey) !== -1;
    });
    if (match) sessionId = match.sessionId;
  }

  try {
    var body = { message: msg };
    if (sessionId) body.sessionId = sessionId;
    else body.agentId = npc.id;

    var data = await api('/api/agent/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    var responseText = extractAgentResponse(data);
    addSpeechBubble(npc.id, responseText, responseText.length > 100 ? 12 : 8);

    // Store in chat history
    if (sessionId) {
      addChatMessage(sessionId, 'user', msg);
      addChatMessage(sessionId, 'agent', responseText);
    }
  } catch (e) {
    addSpeechBubble(npc.id, 'Error: ' + e.message, 5);
  }

  sendBtn.disabled = false;
  input.focus();
}
```

**Step 5: Wire up event listeners for the NPC chat bar**

```javascript
document.getElementById('npcSendBtn').addEventListener('click', sendNPCMessage);
document.getElementById('npcChatInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendNPCMessage();
  }
  if (e.key === 'Escape') {
    closeNPCChat();
  }
});
document.getElementById('npcExpandBtn').addEventListener('click', function() {
  if (!activeNPCChat) return;
  var npc = activeNPCChat.npc;
  closeNPCChat();
  // Find session and open full chat panel
  var sessionId = null;
  var sessionKey = 'agent:' + npc.sessionKey + ':' + npc.sessionKey;
  if (sessionsData && sessionsData.sessions) {
    var match = sessionsData.sessions.find(function(s) {
      return s.key && s.key.indexOf(':' + npc.sessionKey) !== -1;
    });
    if (match) {
      sessionId = match.sessionId;
      sessionKey = match.key;
    }
  }
  if (sessionId) {
    openChat(sessionId, sessionKey, '');
  } else {
    toast('No session found for ' + npc.name, true);
  }
});
```

**Step 6: Hook speech bubbles into game loop**

In `update(dt)`, add: `updateSpeechBubbles(dt);`

In `render(alpha)`, add `renderSpeechBubbles(ctx);` after `renderNPCs(ctx);` (inside the world-space `ctx.save()/restore()` block).

**Step 7: Close NPC chat on Escape**

In the Escape key handler, add NPC chat closing:

```javascript
if (key === 'escape') {
  if (activeNPCChat) {
    closeNPCChat();
  } else if (document.getElementById('chatPanel').classList.contains('active')) {
    closeChat();
  } else if (activeOverlay) {
    closeOverlay();
  } else if (document.getElementById('spawnModal').classList.contains('active')) {
    closeSpawnModal();
  }
}
```

**Step 8: Commit**

```bash
git add command-center/index.html
git commit -m "feat: add speech bubble chat system for NPC agents"
```

---

## Task 6: Slim Down the Side Panel

Make the existing chat panel slimmer (350px instead of 480px) so the game world stays visible behind it.

**Files:**
- Modify: `command-center/index.html` — CSS

**Step 1: Update chat-overlay width**

Change the `.chat-overlay` width from 480px to 350px:

```css
.chat-overlay {
  /* ... existing styles ... */
  width: 350px;  /* was 480px */
}
```

Also update the responsive media queries accordingly:

```css
@media (max-width: 600px) {
  .chat-overlay { width: 100% !important; }
}
@media (min-width: 601px) and (max-width: 900px) {
  .chat-overlay { width: 320px !important; }  /* was 380px */
}
```

**Step 2: Commit**

```bash
git add command-center/index.html
git commit -m "style: slim down chat side panel to 350px"
```

---

## Task 7: NPC Tooltip on Mouse Hover

Update the existing tooltip system to also show NPC info on hover.

**Files:**
- Modify: `command-center/index.html` — mousemove handler

**Step 1: Update the canvas mousemove handler**

Check for NPC hits before station hits in the mousemove handler. If hovering an NPC, show tooltip with their name, role, and status:

```javascript
canvas.addEventListener('mousemove', function(e) {
  var rect = canvas.getBoundingClientRect();
  var sx = e.clientX - rect.left;
  var sy = e.clientY - rect.top;
  var tooltip = document.getElementById('stationTooltip');

  // Check NPCs first
  var npcHit = getNPCAtScreen(sx, sy);
  if (npcHit) {
    canvas.style.cursor = 'pointer';
    var nameEl = document.getElementById('tooltipName');
    clearChildren(nameEl);
    var dot = document.createElement('span');
    dot.className = 'status-dot';
    dot.style.cssText = 'width:6px;height:6px;border-radius:50%;display:inline-block;background:' +
      (npcHit.status === 'online' ? '#00ff88' : npcHit.status === 'scheduled' ? '#fdcb6e' : '#888');
    nameEl.appendChild(dot);
    nameEl.appendChild(document.createTextNode(' ' + npcHit.emoji + ' ' + npcHit.name));
    document.getElementById('tooltipStats').textContent = npcHit.role + ' \u2022 ' + (npcHit.statusText || npcHit.status);
    tooltip.style.left = (e.clientX + 14) + 'px';
    tooltip.style.top = (e.clientY + 14) + 'px';
    tooltip.classList.add('visible');
    return;
  }

  // Then check stations (existing code)
  var hit = getStationAtScreen(sx, sy);
  // ... rest of existing handler
});
```

**Step 2: Commit**

```bash
git add command-center/index.html
git commit -m "feat: add NPC hover tooltips"
```

---

## Task 8: Final Integration + Polish

Wire everything together, add minimap NPC dots, and do a final verification pass.

**Files:**
- Modify: `command-center/index.html`

**Step 1: Add NPC dots to minimap**

In `renderMinimap()`, after the station rectangles loop, add:

```javascript
// NPC dots on minimap
for (var i = 0; i < npcCharacters.length; i++) {
  var npc = npcCharacters[i];
  mctx.fillStyle = npc.color;
  mctx.globalAlpha = 0.8;
  mctx.beginPath();
  mctx.arc(Math.round(npc.cx * sw), Math.round(npc.cy * sh), 2.5, 0, Math.PI * 2);
  mctx.fill();
}
mctx.globalAlpha = 1;
```

**Step 2: Ensure NPC chat bar doesn't interfere with movement**

The NPC chat input needs to be excluded from keyboard movement capture. The existing check for `INPUT` tag in the keydown handler already handles this since `<input>` is used.

**Step 3: Final verification checklist**

1. Open browser → NPCs visible near their related stations
2. Walk near an NPC → prompt shows "Press E — Talk to JARVIS"
3. Press E → chat bar appears at bottom, speech bubbles work
4. Click NPC → same behavior
5. Send message → user bubble appears, then agent response bubble
6. Click expand → switches to slim side panel with full chat
7. Hover NPC → tooltip shows name/role/status
8. Minimap shows colored NPC dots
9. Walk through NPC area → player collides, walks around them
10. Number keys 1-7 still open stations
11. Stations still have all living-stations features (glow, particles, etc.)

**Step 4: Commit**

```bash
git add command-center/index.html
git commit -m "feat: add NPC minimap dots and final integration"
```

---

## Summary

| Task | Description | Complexity |
|------|-------------|------------|
| 1 | Fix chat JSON dump bug | Small fix |
| 2 | NPC data model + position mapping | Data layer |
| 3 | Render NPC characters on canvas | Canvas rendering |
| 4 | NPC collision + proximity + interaction | Game mechanics |
| 5 | Speech bubble chat system | Core feature |
| 6 | Slim down side panel | CSS tweak |
| 7 | NPC hover tooltips | Polish |
| 8 | Final integration + minimap | Wiring |
