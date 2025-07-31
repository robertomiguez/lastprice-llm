# 🧾 Last Price LLM

A smart Cloudflare Worker that uses AI to extract items and prices from messy receipt OCR text. Built to handle any receipt format from any store worldwide.

## ✨ Features

- **🌍 Universal Format Support** - Works with receipts from any store/country
- **🧠 AI-Powered Intelligence** - Uses Groq's Llama3 to understand messy OCR text
- **💰 Smart Price Parsing** - Handles any currency format (€1,99 / $1.99 / £1.50)
- **🔄 Automatic Retry Logic** - Resilient to network failures with exponential backoff
- **🌐 CORS Support** - Ready for web applications
- **📊 Rich Response Format** - Returns structured data with totals and metadata
- **⚡ Fast & Reliable** - Built on Cloudflare's global edge network

## 🚀 Quick Start

### 1. Deploy to Cloudflare Workers

```bash
# Clone or copy the worker code
# Set up your Cloudflare Workers environment
wrangler deploy
```

### 2. Set Environment Variables

Add your Groq API key to your Cloudflare Worker:

```bash
wrangler secret put GROQ_API_KEY
```

### 3. Make a Request

```
POST https://lastprice-llm.nonelabs.workers.dev HTTP/1.1
Content-Type: tapplication/json

{
  "prompt": "AGUA LUSO 1,5L\n1,000\n£ 0,89\nI"
}

```

## 📄 License

This project is open source. Feel free to use and modify as needed.
---

**Made with ❤️ for parsing messy receipts worldwide** 🌍
