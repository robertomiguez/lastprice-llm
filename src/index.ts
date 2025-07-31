interface Env {
  GROQ_API_KEY: string;
}

interface ReceiptItem {
  item: string;
  price: number;
  quantity?: number;
}

interface GroqApiResponse {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
  error?: {
    message: string;
    type: string;
  };
}

interface RequestBody {
  prompt?: string;
  receiptText?: string; // Alternative field name
  maxRetries?: number;
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama3-8b-8192";
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT = 30000; // 30 seconds

// Flexible system prompt for any receipt format
const SYSTEM_PROMPT = `You are an expert at parsing messy receipts from any store format. Your job is to intelligently extract items and their final prices from chaotic OCR text.

CORE MISSION: Find product names and their corresponding prices, regardless of receipt format.

INTELLIGENCE GUIDELINES:
- Every receipt format is different - be adaptive
- Look for patterns: items usually have names and prices nearby
- Prices are typically numbers with decimals (1.99, 1,99, 2.5, etc.)
- Items can be on same line as price or on separate lines
- Quantities might be present (x2, 2x, 1,000 kg, etc.)
- Promotional text, categories, totals, and store info should be ignored
- OCR creates errors: I→1, O→0, garbled text, spacing issues

EXTRACTION STRATEGY:
1. Scan the entire text for price patterns (numbers with 1-2 decimals)
2. For each price, look nearby (above/below/same line) for the item name
3. Clean item names: remove codes, asterisks, extra spaces, promotional text
4. Use context clues to determine what's an item vs. what's metadata
5. Calculate final price if discounts are shown
6. If unsure about an item-price pair, skip it

OUTPUT FORMAT:
Return ONLY a valid JSON array: [{"item": "Item Name", "price": 2.50, "quantity": 1}]

EXAMPLES OF ADAPTIVE PARSING:
Format 1: "Banana 1.50"
Format 2: "Banana\n1.50"  
Format 3: "1x Banana €1,50"
Format 4: "BANANA    1.50\n(discount -0.20)\nFinal: 1.30"
All should extract: [{"item": "Banana", "price": 1.50, "quantity": 1}]

BE SMART: Use your understanding of receipt logic, not rigid rules. Every receipt is a puzzle to solve.`;

async function makeGroqRequest(
  apiKey: string, 
  receiptText: string, 
  retryCount = 0
): Promise<ReceiptItem[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Receipt-Parser-Worker/1.0"
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Receipt Text:\n${receiptText}` }
        ],
        temperature: 0.1, // Lower for more consistent parsing
        max_tokens: 1000,
        top_p: 0.9
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();

      if (response.status === 401) {
        throw new Error("Authentication failed: Invalid Groq API key");
      }

      if (response.status >= 500 && response.status < 600) {
        throw new Error(`GroqServerError ${response.status}: ${errorText}`);
      }

      throw new Error(`Groq API HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json() as GroqApiResponse;
    
    if (data.error) {
      throw new Error(`Groq API Error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("No content received from Groq API");
    }

    return parseReceiptItems(content);
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (retryCount < MAX_RETRIES && 
        (error instanceof TypeError ||
         (error as Error).message.includes("timeout") ||
         (error as Error).message.includes("5"))) {
      console.log(`Retry ${retryCount + 1}/${MAX_RETRIES} after error:`, error);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return makeGroqRequest(apiKey, receiptText, retryCount + 1);
    }

    throw error;
  }
}

function parseReceiptItems(content: string): ReceiptItem[] {
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn("No JSON array found in response:", content);
      return [];
    }

    const jsonString = jsonMatch[0];
    const parsed = JSON.parse(jsonString);
    
    if (!Array.isArray(parsed)) {
      console.warn("Parsed content is not an array:", parsed);
      return [];
    }

    return parsed
      .filter((item: any) => 
        item && 
        typeof item === 'object' && 
        typeof item.item === 'string' && 
        item.item.trim().length > 0 &&
        (typeof item.price === 'number' || typeof item.price === 'string')
      )
      .map((item: any) => ({
        item: item.item.trim(),
        price: normalizePrice(item.price),
        quantity: item.quantity && typeof item.quantity === 'number' ? item.quantity : 1
      }))
      .filter((item: ReceiptItem) => item.price > 0);
      
  } catch (error) {
    console.error("Failed to parse receipt items:", error);
    return [];
  }
}

function normalizePrice(price: string | number): number {
  if (typeof price === 'number') {
    return Math.round(price * 100) / 100;
  }
  
  let cleaned = price
    .replace(/[^\d,.-]/g, '')
    .replace(/I/gi, '1')
    .replace(/O/gi, '0')
    .replace(/l/gi, '1')
    .trim();

  if (cleaned.includes(',') && !cleaned.includes('.')) {
    cleaned = cleaned.replace(',', '.');
  } else if (cleaned.includes(',') && cleaned.includes('.')) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  }

  const parts = cleaned.split('.');
  if (parts.length === 2 && parts[1].length > 2) {
    cleaned = parts[0] + parts[1].substring(0, parts[1].length - 2) + '.' + parts[1].substring(parts[1].length - 2);
  }
    
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100;
}

function validateRequestBody(body: any): { receiptText: string; maxRetries?: number } {
  if (!body || typeof body !== 'object') {
    throw new Error("Request body must be a JSON object");
  }

  const receiptText = body.prompt || body.receiptText;
  if (!receiptText || typeof receiptText !== 'string') {
    throw new Error("Missing required field 'prompt' or 'receiptText'");
  }

  if (receiptText.trim().length === 0) {
    throw new Error("Receipt text cannot be empty");
  }

  if (receiptText.length > 10000) {
    throw new Error("Receipt text too long (max 10,000 characters)");
  }

  return {
    receiptText: receiptText.trim(),
    maxRetries: typeof body.maxRetries === 'number' ? body.maxRetries : MAX_RETRIES
  };
}

function createErrorResponse(message: string, status = 400): Response {
  return new Response(
    JSON.stringify({ error: message, timestamp: new Date().toISOString() }),
    { 
      status,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    }
  );
}

function createSuccessResponse(data: ReceiptItem[]): Response {
  const response = {
    success: true,
    timestamp: new Date().toISOString(),
    itemCount: data.length,
    totalAmount: data.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0),
    items: data
  };

  return new Response(JSON.stringify(response), {
    headers: { 
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (request.method !== "POST") {
      return createErrorResponse("Method not allowed. Use POST.", 405);
    }

    if (!env.GROQ_API_KEY) {
      console.error("Missing GROQ_API_KEY environment variable");
      return createErrorResponse("Server configuration error", 503);
    }

    try {
      const body = await request.json() as RequestBody;
      const { receiptText } = validateRequestBody(body);
      const items = await makeGroqRequest(env.GROQ_API_KEY, receiptText);
      return createSuccessResponse(items);

    } catch (error) {
      console.error("Worker error:", error);

      if (error instanceof SyntaxError) {
        return createErrorResponse("Invalid JSON in request body");
      }

      if ((error as Error).message.includes("Missing required field")) {
        return createErrorResponse((error as Error).message);
      }

      if ((error as Error).message === "Authentication failed: Invalid Groq API key") {
        return createErrorResponse("Invalid or missing GROQ_API_KEY", 401);
      }

      return createErrorResponse("Internal server error", 500);
    }
  }
};
