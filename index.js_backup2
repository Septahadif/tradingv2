const AI_PROXY_ENDPOINT = "https://free.v36.cm/v1/chat/completions";
const MODEL = "gpt-4o-mini";

// Hardcoded credentials
const TELEGRAM_BOT_TOKEN = "7484227045:AAF1CmbY2cOW_7C_NObYCiOGNUNK3Sqehlg";
const TELEGRAM_CHAT_ID = "5026145251";
const PRE_SHARED_TOKEN = "supersecret123"; // Replace with your actual token

// Multiple FREEV36 API keys for rotation
const FREEV36_API_KEYS = [
  "sk-UdLUDFMEdxwxocNTF77505236a764c8c894bCdE76e239844",
  "sk-vfO24apoNhPF08qN820c1c779305445194Cb5586Bd2c6852"
];

// Key rotation management
let currentApiKeyIndex = 0;
let lastKeyRotation = Date.now();

function getCurrentApiKey() {
  const now = Date.now();
  const sixHours = 6 * 60 * 60 * 1000;
  
  // Rotate key every 6 hours
  if (now - lastKeyRotation >= sixHours) {
    currentApiKeyIndex = (currentApiKeyIndex + 1) % FREEV36_API_KEYS.length;
    lastKeyRotation = now;
    console.log(`Rotated to API key index: ${currentApiKeyIndex}`);
  }
  
  return FREEV36_API_KEYS[currentApiKeyIndex];
}

// Enhanced market analysis with trade recommendations
async function analyzeMarket(symbol, timeframe, ohlc, indicators, volume, avgVolume, keyLevels, h1Trend) {
  const priceAction = `
    Harga saat ini: ${ohlc.close}
    Open: ${ohlc.open}, High: ${ohlc.high}, Low: ${ohlc.low}
    Support terdekat: ${keyLevels.s1}, Resistance terdekat: ${keyLevels.r1}
  `;

  const indicatorAnalysis = `
    Indikator saat ini:
    - EMA5: ${indicators.ema5} (${indicators.ema5 > ohlc.close ? 'di atas' : 'di bawah'} harga)
    - EMA13: ${indicators.ema13} 
    - RSI: ${indicators.rsi} (${indicators.rsi > 70 ? 'overbought' : indicators.rsi < 30 ? 'oversold' : 'netral'})
    - Volume: ${volume} (rata-rata ${avgVolume})
    - Trend H1: ${h1Trend}
  `;

  const prompt = `
    Saya trading ${symbol} di timeframe ${timeframe}. Berikan analisis dalam format JSON dengan field:
    - "signal" (buy/sell/hold)
    - "explanation" (penjelasan dalam bahasa natural)
    - "confidence" (high/medium/low)
    - "entry" (harga entry yang disarankan)
    - "stopLoss" (harga stop loss yang disarankan)
    - "takeProfit" (harga take profit yang disarankan)

    ${priceAction}
    ${indicatorAnalysis}

    Berikan rekomendasi trading yang praktis dengan:
    1. Entry price yang realistis
    2. Stop loss yang wajar (1-2% dari entry untuk M5, 2-3% untuk H1)
    3. Take profit dengan risk-reward ratio minimal 1:2
    4. Pertimbangkan support/resistance terdekat

    Contoh response:
    {
      "signal": "buy",
      "explanation": "Harga rebound dari support dengan volume tinggi dan RSI oversold",
      "confidence": "high",
      "entry": 3350.50,
      "stopLoss": 3348.00,
      "takeProfit": 3355.00
    }
  `;

  const payload = {
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 200,
    response_format: { type: "json_object" }
  };

  const resp = await fetch(AI_PROXY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getCurrentApiKey()}`
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`AI error: ${resp.status} ${errText}`);
  }

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || "";
}

// Enhanced Telegram notification with trade details
// Simplified Telegram notification without View Chart button
async function sendTelegramAlert(signalData, marketData) {
  const { symbol, timeframe } = marketData;
  const { signal, explanation, confidence, entry, stopLoss, takeProfit } = signalData;

  // Calculate risk-reward ratio if available
  let rrRatio = "";
  if (entry && stopLoss && takeProfit) {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    rrRatio = `Risk/Reward: 1:${(reward / risk).toFixed(2)}\n`;
  }

  // Determine emoji based on signal
  const emoji = signal === "buy" ? "🟢 BUY" : signal === "sell" ? "🔴 SELL" : "🟡 HOLD";
  
  // Format simplified message
  let message = `${emoji} (${confidence} confidence)\n`;
  
  if (signal !== "hold") {
    message += `Entry: ${entry?.toFixed(2) || "N/A"}\n`;
    message += `Stop Loss: ${stopLoss?.toFixed(2) || "N/A"}\n`;
    message += `Take Profit: ${takeProfit?.toFixed(2) || "N/A"}\n`;
    message += `${rrRatio}\n`;
  }
  
  message += `\n💡 Analysis: ${explanation}\n\n`;
  message += `⏱ ${new Date().toLocaleString()}`;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: "Markdown"
  });

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body
    });
    
    if (!resp.ok) {
      console.error("Telegram error:", await resp.text());
    }
  } catch (e) {
    console.error("Failed to send Telegram:", e);
  }
}

// Main request handler
addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // Validate request method
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Only POST requests accepted" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Authenticate
  const apiKey = request.headers.get("x-api-key");
  if (apiKey !== PRE_SHARED_TOKEN) {
    return new Response(JSON.stringify({ error: "Invalid API key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Parse input data
    const inputData = await request.json();
    
    // Validate required fields
    if (!inputData.symbol || !inputData.timeframe || !inputData.ohlc || !inputData.indicators) {
      return new Response(JSON.stringify({ error: "Missing required market data" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Prepare market data with defaults
    const marketData = {
      symbol: inputData.symbol,
      timeframe: inputData.timeframe,
      ohlc: inputData.ohlc,
      indicators: inputData.indicators,
      volume: inputData.volume || 0,
      avgVolume: inputData.avgVolume || inputData.volume || 1,
      keyLevels: inputData.keyLevels || { s1: 0, r1: 0 },
      higherTF: inputData.higherTF || { h1Trend: "neutral" }
    };

    // Get AI analysis
    const aiResponse = await analyzeMarket(
      marketData.symbol,
      marketData.timeframe,
      marketData.ohlc,
      marketData.indicators,
      marketData.volume,
      marketData.avgVolume,
      marketData.keyLevels,
      marketData.higherTF.h1Trend
    );

    // Parse AI response
    let signalData;
    try {
      signalData = JSON.parse(aiResponse);
      
      // Validate required fields
      if (!signalData.signal || !signalData.explanation) {
        throw new Error("Invalid AI response format");
      }
      
      // Set defaults for trade details if not provided
      signalData.entry = signalData.entry || null;
      signalData.stopLoss = signalData.stopLoss || null;
      signalData.takeProfit = signalData.takeProfit || null;
      signalData.confidence = signalData.confidence || "medium";
      
    } catch (e) {
      return new Response(JSON.stringify({ 
        error: "Failed to parse AI response",
        ai_response: aiResponse
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Send Telegram notification
    await sendTelegramAlert(signalData, marketData);

    // Return response to client
    return new Response(JSON.stringify(signalData), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: "Processing error",
      message: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
