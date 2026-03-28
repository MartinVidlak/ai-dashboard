# 🤖 AI Hybrid-Cloud Dashboard

A modern, responsive web interface built with **React** and **Tailwind CSS** that serves as a bridge between cloud hosting and local AI power. This dashboard allows you to interact with locally running LLMs (via LM Studio) and Image Generators (via Stable Diffusion Forge) from anywhere in the world.

![Dashboard Preview](https://via.placeholder.com/800x450.png?text=AI+Dashboard+Preview+Click+to+See+Live) 
*(Tip: Nahraď tento obrázek screenshotem tvého dashboardu s tím psem ve slunečnicích!)*

## 🚀 Key Features

- **Cloud-to-Local Bridge:** Hosted on Vercel, but powered by your local GPU.
- **Smart Image Generation:** Integrated with SD Forge API with automatic prompt formatting.
- **Real-time Chat:** Interactive chat interface for local LLM models (Mistral-Nemo).
- **Dynamic Endpoints:** Change your API URLs on the fly without redeploying.
- **Hybrid Security:** Uses Localtunnel with custom bypass headers to secure the connection.

## 🛠 Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS
- **Deployment:** Vercel (CI/CD via GitHub)
- **AI Engines:** - [LM Studio](https://lmstudio.ai/) (Local Inference Server)
  - [Stable Diffusion Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge) (Image Generation)
- **Connectivity:** [Localtunnel](https://theclover.github.io/localtunnel-docs/) (Reverse Proxy)

## 📦 Getting Started

### 1. Local Setup
Ensure you have the following running on your local machine:
- **LM Studio:** Server started on port `1234`.
- **SD Forge:** Started with `--api` flag on port `7860`.
-----
### 2. Create the Tunnel
Expose your local port to the internet:
```bash
npm install -g localtunnel
lt --port 7860
-----
3. Connect the Dashboard
Open the Live Demo
Open your generated .loca.lt URL in a new tab to bypass the initial reminder.
Paste the URL into the IMAGE GENERATOR — FORGE field in the dashboard settings.

💡 Technical Challenges Overcome
CORS & Tunnel Blockers: Implemented custom fetch headers (Bypass-Tunnel-Reminder) to allow seamless API communication through reverse proxies.
Asynchronous UI: Developed a robust state management system to handle image generation loading states and gallery updates.
Prompt Engineering: Built a system that automatically enhances simple user descriptions into high-quality Stable Diffusion prompts.
