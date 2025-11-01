# 🧠✨ Tab Whisperer — Chrome AI Extension

> **“Let your tabs speak.”**  
> Tab Whisperer is a next-generation Chrome AI extension that automatically **summarizes**, **groups**, and **manages** your open tabs using **Google Gemini Nano** — the built-in Chrome AI model.  
> It’s your intelligent browser companion that helps you stay focused, declutter your workspace, and rediscover your flow.

---

## 🎥 Demo Video
🎬 *[Watch the Demo — Coming Soon!](#)*  

---

## 🧩 Try It Yourself
📦 *[Download Tab Whisperer (ZIP)](#)*  

---

## 💡 Overview

**Tab Whisperer** reads all your open tabs and uses AI to:
- 🧠 Generate **smart summaries** for each tab  
- 🗂️ Automatically **group related tabs** by topic  
- ⭐ Let you **star**, **save**, or **close** tabs directly  
- 🧹 Help you focus by **decluttering** unused ones  
- 📚 Preserve your research context and revisit anytime  

All powered by **Gemini**

---

## 🧭 How It Works — System Flow

🪄 Below is a placeholder for your architecture diagram / flow chart:

````markdown
> +------------------+         +------------------+         +------------------+
> |  Open Chrome     |  --->   |  Background.ts   |  --->   |  Gemini Summarizer |
> |  Tabs (titles &  |         |  collects tab    |         |  (summaries +     |
> |  URLs)           |         |  metadata        |         |  groupings)       |
> +------------------+         +------------------+         +------------------+
>            |                                                       |
>            v                                                       v
>      +------------------+                               +------------------+
>      |  Storage Layer   | <---------------------------> |  Sidebar (UI)    |
>      |  (Saved Tabs,    |                               |  Interactive tab |
>      |  Groups, Stars)  |                               |  management)     |
>      +------------------+                               +------------------+

## 🏗️ Folder Structure

tab-whisperer/
├── src/
│   ├── background.ts             # Handles Chrome events, tab grouping & summarization
│   ├── components/               # React + ShadCN UI components
│   ├── lib/
│   │   ├── gemini.ts             # AI summarization logic (Gemini Nano integration)
│   │   ├── storage.ts            # Handles SavedTab, renameGroup, etc.
│   │   └── utils.ts              # Helper utilities
│   ├── pages/
│   │   ├── sidebar.tsx           # Sidebar main interface
│   │   └── popup.tsx             # Popup opened via toolbar icon
│   ├── styles/                   # Tailwind + custom styling
│   ├── manifest.json             # Chrome manifest v3
│   └── icons/                    # Logos and icons
│
├── package.json
├── tailwind.config.ts
├── vite.config.ts
└── README.md

````

## ⚙️ Tech Stack

| Category | Technology |
|-----------|-------------|
| 🧠 **AI Engine** | Google Gemini (Built-in Chrome AI) |
| ⚡ **Frontend Framework** | React + TypeScript |
| 🎨 **UI Styling** | Tailwind CSS + ShadCN/UI |
| 📦 **Bundler** | Vite |
| 💾 **Storage** | Chrome Storage API (local + session) |
| 🧱 **Manifest Version** | v3 |

---

## 🚀 Getting Started (Local Development)

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/<yourusername>/tab-whisperer.git
cd tab-whisperer
````

### 2️⃣ Install Dependencies

```bash
npm install
```

### 3️⃣ Build the Project

```bash
npm run build
```

### 4️⃣ Load into Chrome

1. Open `chrome://extensions/`
2. Enable **Developer Mode**
3. Click **Load unpacked**
4. Select the `dist/` folder after build

---

## 🧠 Using Tab Whisperer

1. 🧩 Click the **Tab Whisperer icon** in your Chrome toolbar
2. 📋 See summaries and groups of your open tabs
3. 🪄 Click **Summarize Tabs** → AI generates context & intent
4. ⭐ Save or 🗑️ close tabs directly from the sidebar
5. 💾 Return later to your starred or saved sessions

Everything runs **locally**, fast, and private.

---

## 🔐 Permissions Overview

| Permission  | Why It’s Needed                     |
| ----------- | ----------------------------------- |
| `tabs`      | To read tab titles and URLs         |
| `storage`   | To save starred/saved tabs          |
| `sidePanel` | For rendering the AI sidebar        |
| `activeTab` | To summarize the current tab        |
| `scripting` | For content scripts and DOM actions |

---

## 🧩 Example: Sidebar UI (Grouped-View)

>
> ```
> [ 📸 Screenshot Placeholder ]
> ```
>

---

## 🧰 Developer Notes

* Uses **`chrome.storage.session`** for temporary data
* Groups tabs via **`groupTabsByIdStrict()`** for consistent session IDs
* Summaries fetched from **`summarizeTabs()`** powered by Gemini AI

---

## 🛣️ Future plans

* [ ] 🪞 Add multi-window synchronization
* [ ] 📎 Session save/export feature
* [ ] 🗺️ Visual mind-map view for grouped tabs
* [ ] 🌓 Theme toggle (light/dark)
* [ ] 🧭 Web Store release

---

## 👨‍💻 Authors & Credits

| Name                          | Role                            |
| ----------------------------- | ------------------------------- |
| **Joshua Alexander Silalahi** | Frontend / AI Integration       |
| **Kimberly Mazel**            | Prototyping / Design            |
| **Arish Mada**                | UX / Chrome API Integration     |
| **Team Tab-Whisperer**        | Google Chrome AI Challenge 2025 |

---

## ❤️ Acknowledgements

Built for the **Google Chrome Built-in AI Challenge 2025**,
inspired by the vision of **making browsing effortless with on-device intelligence.**

---

> *“Whisper to your tabs — and they’ll whisper back what matters most.”*

