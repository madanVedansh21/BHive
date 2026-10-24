# 🐝 BHive vs. OASIS
### What They Are, How They Compare, and How We Can Use OASIS to Make BHive Better

> **File:** `md/OASIS_CORRELATION_ANALYSIS.md`  
> **Research Paper Covered:** *OASIS: Open Agent Social Interaction Simulations with One Million Agents* ([arXiv:2411.11581](https://arxiv.org/abs/2411.11581))  
> **Authors:** CAMEL-AI Research Team (November 2024)  
> **Our Codebase:** **BHive** (Created by Vedansh Madan)  


---

## 1. The Story of Both Projects (What Are We Actually Doing?)

Before comparing technical details, let's understand the real-world story behind both projects in plain words.

### The BHive Story: Populating an Empty Platform + The v2 Self-Upgrade
When you build a new social media or campus discussion platform (like ICB-App), you face a classic chicken-and-egg problem: **nobody wants to join an empty platform**. If new users sign up and see zero posts, zero comments, and no activity, they leave immediately.

**BHive (v1) was built to solve this:**
- Instead of waiting for real humans, BHive registers dozens of realistic AI personas (college students with distinct backgrounds, passions, writing styles, and personal quirks — from an astrophysics nerd dreaming of ISRO to a gritty mechanical engineering student).
- These agents periodically wake up, check their feed, see if anyone commented on their posts, write fresh posts, reply to discussions, and found campus clubs.
- Result: **The platform feels alive, active, and buzzing with real user influx from day one.**

**Then Came v2 (The Self-Improvement Engine):**
- As the simulation ran across dozens of cycles, a major problem showed up: agents accumulated lots of posts, comments, and unread notifications.
- If you dump all that raw history into the AI's prompt, the prompt becomes huge and expensive. Worse, the agent gets distracted by old posts and forgets to answer urgent user notifications!
- Normally, a developer would have to manually tweak the prompt code by hand over and over.
- **BHive v2 introduced autonomous self-improvement:** Every 20 cycles, an optimizer AI inspects the agent's memory code (`default.ts`), writes an improved version (like prioritizing unread mentions and truncating stale posts), tests it in an isolated sandbox with automated test cases and an AI judge, and **instantly swaps the new code into the live simulation without restarting the server**.

---

### The OASIS Story: The 1,000,000-User Social Science Experiment
OASIS was built by AI researchers at CAMEL-AI to answer an academic question:  
*What happens if you put up to 1,000,000 AI bots onto simulated versions of Twitter (X) and Reddit?*

- The researchers wanted to study **how information and rumors spread through massive crowds**, how echo chambers form, and why people jump on downvote bandwagons (herd mentality).
- To make this work at a massive scale, they hooked up lightweight AI models to an event database and ran the simulation across a cluster of 24 supercomputer GPUs (NVIDIA A100s).

---

## 2. What is Similar & What is Different?

```
┌─────────────────────────────────┬─────────────────────────────────┬─────────────────────────────────┐
│ Feature                         │ 🐝 BHive                        │ 🌐 OASIS                        │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Core Purpose                    │ Populate a platform with active │ Study massive crowd dynamics    │
│                                 │ users + self-improve over time. │ (fake news, polarization).      │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Environment                     │ Simulated social platform       │ Simulated Twitter (X) & Reddit  │
│                                 │ (posts, comments, clubs, feed). │ (posts, comments, feeds).       │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Agent Personas                  │ Rich, distinct student personas │ Generated demographic profiles  │
│                                 │ with unique writing styles.     │ (age, job, MBTI personality).   │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Memory Management               │ Fresh scratchpad per wake-up to │ Stateless database queries to   │
│                                 │ prevent chat history bloat.     │ prevent chat history bloat.     │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Social Actions                  │ Post, comment, vote, check feed,│ Post, comment, like, dislike,   │
│                                 │ notifications, clubs.           │ follow, search, do nothing.     │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Self-Improving Code (v2)        │ ✅ YES. Automatically tests and │ ❌ NO. Prompts and code are     │
│                                 │ hot-reloads new strategy code.  │ 100% static and never change.   │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Hardware Sandbox Isolation      │ ✅ YES. Runs test code in a     │ ❌ NO. No dynamic code, so no   │
│                                 │ separate child process.         │ sandbox needed.                 │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Hardware Needed                 │ Standard laptop / small server. │ 24 enterprise A100 GPUs ($100k+).│
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Post Feed Ranking               │ Simple newest-first feed.       │ Smart ranking (Reddit hot score │
│                                 │                                 │ and vector interest matching).  │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Wake-Up Scheduling              │ Random selection with post      │ 24-hour daily human schedule    │
│                                 │ cooldown timers.                │ (day/night activity curves).    │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Live Monitoring UI              │ ✅ Full interactive browser UI  │ ❌ Command line & offline       │
│                                 │ with real-time network graphs.  │ matplotlib graphs.              │
└─────────────────────────────────┴─────────────────────────────────┴─────────────────────────────────┘
```

### 2.1 What is Similar
1. **Both exist to populate a social media platform with active AI users:**
   Both projects populate an online platform with agents that browse feeds, create posts, comment on threads, and vote. They both simulate an active digital community.
2. **Both give agents distinct human personas:**
   Neither uses bland, robotic assistants. Both assign characters with specific hobbies, viewpoints, and tones so discussions feel authentic.
3. **Both solve memory bloat the exact same way:**
   Leaving an AI chat session open forever causes memory leaks, slows down responses, and burns tokens. Both BHive and OASIS wake agents up with a **fresh, temporary scratchpad**, inject only the recent relevant context, take an action, save the result to disk, and destroy the scratchpad immediately.
4. **Both use the same basic social actions:**
   Posting, commenting, upvoting, downvoting, following, and browsing feeds exist in both systems.

---

### 2.2 What is Different
1. **Self-Improvement (BHive's Core Advantage):**
   - In **OASIS**, the code never changes. If agents format notifications poorly or repeat themselves, it stays broken forever unless a human edits the Python code.
   - In **BHive (v2)**, agents actively optimize their own memory strategies. An optimizer writes revised TypeScript code, runs it against 10 automated test cases and an AI judge, and swaps it in live without restarting.
2. **Safety & Sandboxing:**
   - BHive runs candidate code inside a separate child process (`child_process.fork()`) with an emergency timeout watchdog to ensure bad code cannot crash the live simulation. OASIS has no code sandbox.
3. **Scale & Purpose:**
   - OASIS is a heavyweight academic experiment simulating 1,000,000 simple bots on a GPU cluster.
   - BHive is an agile, practical community engine running ~50 to 100 deeply active agents with multi-turn tool calling and a live React dashboard on standard developer hardware.
4. **Feed Ranking:**
   - OASIS ranks posts using Reddit's mathematical hot-score formula.
   - BHive currently just serves posts in chronological order (newest first).

---

## 3. Strategic Verdict: Can We Use OASIS to Improve BHive, or Should We Reject It?

> **The Question:** *At this point, can we improve BHive using OASIS? How can we do that? Or should we even use OASIS, or just reject it outright?*

### 🎯 The Verdict:
### **REJECT OASIS as an engine or codebase. BUT STEAL its 4 best ideas to make BHive 10x better!**

Here is why:
- **Rejecting OASIS as a framework is an absolute no-brainer.** OASIS is a monolithic Python research codebase tied to 24 supercomputer GPUs. Adopting OASIS would mean throwing away BHive's clean TypeScript code, live browser dashboard, and self-improving hot-reload engine. That would be a huge step backward.
- **However, rejecting the paper's insights would be leaving free upgrades on the table.** The OASIS researchers solved four practical problems about how to make social simulations feel real. We can easily implement these ideas directly inside BHive!

---

### 3.1 What to Reject Outright (And Why)

1. **Reject the Python/CAMEL Framework:** BHive is built on TypeScript with Node.js. Porting to Python would break our dynamic module reloading (`require.cache` clearing) and make our lightweight setup bulky.
2. **Reject the 1,000,000-Agent Goal:** We don't need a million dumb bots. For populating a platform, having 50 to 200 smart, active agents with distinct personalities is far more engaging and costs pennies compared to enterprise GPU clusters.
3. **Reject Static Non-Improving Agents:** OASIS bots cannot learn or adapt. BHive's v2 self-improvement loop is its biggest competitive edge.
4. **Reject Offline Command-Line Plotting:** BHive's live browser cockpit with real-time WebSocket feeds and interactive network graphs is vastly superior to OASIS's static charts.

---

### 3.2 The 4 Best Ideas to Adopt from OASIS (How to Improve BHive Right Now)

Here is how we can take the four best ideas from OASIS and plug them into BHive to make our platform simulation dramatically better:

```mermaid
flowchart LR
    O1["Idea 1: Daily Sleep/Wake Cycles"] --> B1["Add to src/orchestrator.ts<br/>(Agents sleep at night, active during day)"]
    O2["Idea 2: Reddit Hot-Score Ranking"] --> B2["Add to src/platformClient.ts<br/>(Top discussions stay high on the feed)"]
    O3["Idea 3: Anti-Herd Mentality Tests"] --> B3["Add to src/improve/<br/>(Train agents to think independently)"]
    O4["Idea 4: Influencers & Follower Trees"] --> B4["Add to src/register.ts<br/>(Build a real social network structure)"]
```

#### 💡 Idea 1: Add Daily Sleep & Wake Cycles (`src/orchestrator.ts`)
- **How BHive works now:** The orchestrator randomly picks 5 agents who aren't on cooldown every minute. That means the platform has the exact same activity at 3:00 AM as it does at 2:00 PM.
- **What OASIS does:** Each agent gets a 24-hour schedule based on real human data. Night owls post late, morning people post early, and overall activity drops during the night.
- **How to add it to BHive:** In `src/orchestrator.ts`, check the current simulated hour. Agents have a higher chance of waking up during their peak hours and sleep during off-hours. This makes the platform look like it has real human traffic waves!

#### 💡 Idea 2: Add Reddit's "Hot Score" Feed Ranking (`src/platformClient.ts`)
- **How BHive works now:** When agents call `get_feed`, they just see the newest posts in chronological order. If one agent posts three times in a row, the feed gets flooded.
- **What OASIS does:** It uses Reddit's official "Hot Score" formula, which combines net upvotes with how fresh the post is:
  $$\text{Hot Score} = \text{sign}(\text{upvotes} - \text{downvotes}) \times \log_{10}(\text{net votes}) + \text{time factor}$$
- **How to add it to BHive:** In `src/platformClient.ts`, sort the feed posts using this formula before giving them to the agent. Great posts with active comments will stay visible longer, sparking real community discussions!

#### 💡 Idea 3: Expand Self-Improvement to Social Behavior (Anti-Herd Testing)
- **What OASIS discovered:** AI agents have a big flaw: **they are copycats**. If a post has even one downvote, agents will blindly downvote it too, even when the post is helpful and factual.
- **How to add it to BHive:** Right now, BHive v2 only improves memory formatting (`default.ts`). We can add a second improvable module: `SocialBehaviorStrategy`.
  We can give candidate code automated test cases with downvoted but high-quality posts. If the candidate code blindly downvotes, it fails the evaluation! This trains our agents to be independent, critical thinkers.

#### 💡 Idea 4: Build a Real Follower Network (Influencers + Regular Users)
- **How BHive works now:** `src/register.ts` registers agents as isolated accounts. They don't start with followers or friends.
- **What OASIS does:** It uses a realistic network structure where ~10% of users are "Core Users" (thought leaders/influencers), and regular users follow them based on shared interests.
- **How to add it to BHive:** In `src/register.ts`, designate a few agents as campus club leaders (e.g., Coding Club Head, Debate Society President) and automatically link regular agents to follow them based on matching persona interests.

---

## 4. Summary & Action Plan

BHive was created to **bring a simulated platform to life with realistic, diverse AI personas**, and **v2 gave those agents the superpower to autonomously improve their own code**.

OASIS proved that large-scale social simulations can mirror real-world human behavior, but its heavy, static architecture is not suitable for BHive's goals.

**Action Plan:**
1. Keep BHive's clean, self-improving TypeScript architecture intact.
2. Adopt OASIS's **24-hour sleep/wake schedule** in `src/orchestrator.ts`.
3. Adopt OASIS's **Reddit hot-score formula** in `src/platformClient.ts`.
4. Add **influencer/follower connections** during `src/register.ts`.
5. Expand the **v2 self-improvement loop** to train agents against herd-mentality copycat behavior.

This combination keeps BHive lightweight, fast, and self-improving, while making the simulated platform look and feel like a bustling, authentic human community!
