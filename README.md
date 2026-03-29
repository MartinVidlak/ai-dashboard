# 🤖 AI Hybrid-Cloud Dashboard

A professional, responsive web interface built with **React** and **Tailwind CSS**. This project serves as a centralized hub for interacting with local AI models (LLMs and Image Generators) through a secure cloud-to-local bridge.

![AI Dashboard Preview](./public/screenshot.png) 
*(Note: Replace this with your actual sunflower dog screenshot!)*

## 🚀 Key Features

- **Hybrid Infrastructure:** Hosted on Vercel, powered by local hardware via secure tunneling.
- **Smart Image Generation:** Seamless integration with Stable Diffusion Forge API.
- **Advanced Gallery Management:** Real-time image generation with "Delete" functionality and preview modes.
- **Dynamic Configuration:** Ability to update API endpoints (LM Studio/Forge) directly from the UI.
- **Localized Connection Status:** Real-time monitoring of local server availability.
- **Professional UX:** Skeleton loaders, responsive design, and intuitive navigation.

## 🛠 Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS
- **Deployment:** Vercel (CI/CD via GitHub)
- **AI Backend:** - [LM Studio](https://lmstudio.ai/) (for LLM / Chat)
  - [SD Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge) (for Image Generation)
- **Networking:** [Localtunnel](https://localtunnel.github.io/www/) (Reverse Proxy)

## 📦 Daily Setup Guide

To get the dashboard running with your local AI engines:

1. **Start Forge:** Run `webui-user.bat` with the `--api` flag.
2. **Start LM Studio:** Launch the local server on port `1234`.
3. **Establish Tunnel:**
   ```bash
   lt --port 7860 --subdomain your-custom-name

    Authorize: Open the generated .loca.lt URL once in your browser and click "Click to Submit" to bypass the reminder.

    Connect: Paste the tunnel URL into the IMAGE GENERATOR — FORGE field in the live app.

💡 Engineering Challenges Overcome

    CORS & Tunnel Bypass: Solved "511 Network Authentication Required" errors by implementing custom Bypass-Tunnel-Reminder headers in API requests.

    Asynchronous State: Managed complex React states for real-time gallery updates and loading animations during heavy AI inference.

    CI/CD Workflow: Established a professional development pipeline from local commits to automated Vercel deployments.
