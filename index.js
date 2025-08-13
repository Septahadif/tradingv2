const AI_PROXY_ENDPOINT = "https://free.v36.cm/v1/chat/completions";
const MODEL = "gpt-4o-mini";

// Hardcoded credentials
const TELEGRAM_BOT_TOKEN = "7484227045:AAF1CmbY2cOW_7C_NObYCiOGNUNK3Sqehlg";
const TELEGRAM_CHAT_ID = "5026145251";
const PRE_SHARED_TOKEN = "supersecret123";

// Multiple FREEV36 API keys for rotation
const FREEV36_API_KEYS = [
  "sk-UdLUDFMEdxwxocNTF77505236a764c8c894bCdE76e239844",
  "sk-vfO24apoNhPF08qN820c1c779305445194Cb5586Bd2c6852"
];

// Key rotation management
let currentApiKeyIndex = 0;
let lastKeyRotation = Date.now();

function getCurrentApiKey() {
  if (FREEV36_API_KEYS.length === 0) throw new Error("No API keys available");
  
  const now = Date.now();
  const sixHours = 6 * 60 * 60 * 1000;
  
  if (now - lastKeyRotation >= sixHours) {
    currentApiKeyIndex = (currentApiKeyIndex + 1) % FREEV36_API_KEYS.length;
    lastKeyRotation = now;
    console.log(`Rotated to API key index: ${currentApiKeyIndex}`);
  }
  
  return FREEV36_API_KEYS[currentApiKeyIndex];
}

async function analyzeMarket(symbol, timeframe, ohlc, indicators, volume, avgVolume, keyLevels, m15Trend) {
  if (!ohlc || typeof ohlc.close !== 'number') {
    throw new Error("Invalid OHLC data");
  }

  const priceAction = `
    Harga saat ini: ${ohlc.close}
    Open: ${ohlc.open}, High: ${ohlc.high}, Low: ${ohlc.low}
    Support terdekat: ${keyLevels.s1}, Resistance terdekat: ${keyLevels.r1}
  `;

  const indicatorAnalysis = `
    analisis indikator ini:
    - EMA9 (M5): ${indicators.ema9} (${indicators.ema9 > ohlc.close ? 'di atas' : 'di bawah'} harga)
    - EMA21 (M5): ${indicators.ema21}
    - EMA50 (M15): ${indicators.ema50}
    - Stochastic: K=${indicators.stochK}, D=${indicators.stochD} (${indicators.stochK > 80 ? 'overbought' : indicators.stochK < 20 ? 'oversold' : 'netral'})
    - Bollinger Bands: Upper=${indicators.bb_upper}, Lower=${indicators.bb_lower}
    - Volume: ${volume} (${volume > avgVolume * 1.5 ? 'tinggi' : 'normal'})
    - Trend M15: ${m15Trend}
  `;

  const prompt = `
    Saya trading ${symbol} di timeframe ${timeframe}. Berikan analisis berdasarkan indikator + ohlc dalam format JSON dengan field:
    - "signal" (buy/sell/hold)
    - "explanation" (penjelasan dalam bahasa natural)
    - "confidence" (high/medium/low)
    - "entry" (harga entry yang disarankan)
    - "stopLoss" (harga stop loss yang disarankan)
    - "takeProfit" (harga take profit yang disarankan)
    - "riskReward" (hitung risk/reward ratio secara otomatis)

    Hitung risk/reward ratio dengan:
    1. Risk = |entry - stopLoss|
    2. Reward = |takeProfit - entry|
    3. Pastikan minimal 1:1.5

    ${priceAction}
    ${indicatorAnalysis}

    Contoh response:
    {
      "signal": "buy",
      "explanation": "EMA9 cross di atas EMA21 dengan harga di atas EMA50 M15...",
      "confidence": "high",
      "entry": 1.0855,
      "stopLoss": 1.0840,
      "takeProfit": 1.0875,
      "riskReward": 1.67
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
  const responseText = data?.choices?.[0]?.message?.content || "";
  
  try {
    const signalData = JSON.parse(responseText);
    if (signalData.entry) signalData.entry = parseFloat(signalData.entry.toFixed(4));
    if (signalData.stopLoss) signalData.stopLoss = parseFloat(signalData.stopLoss.toFixed(4));
    if (signalData.takeProfit) signalData.takeProfit = parseFloat(signalData.takeProfit.toFixed(4));
    return JSON.stringify(signalData);
  } catch (e) {
    return responseText;
  }
}

async function sendTelegramAlert(signalData, marketData) {
  const { symbol, timeframe } = marketData;
  const { signal, explanation, confidence, entry, stopLoss, takeProfit, riskReward } = signalData;

  let rrRatio = "";
  if (riskReward) {
    rrRatio = `Risk/Reward: 1:${riskReward.toFixed(2)}\n`;
  } else if (entry && stopLoss && takeProfit) {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    rrRatio = `Risk/Reward: 1:${(reward / risk).toFixed(2)}\n`;
  }

  const emoji = signal === "buy" ? "🟢 BUY" : signal === "sell" ? "🔴 SELL" : "🟡 HOLD";
  
  let message = `${emoji} (${confidence} confidence)\n`;
  
  if (signal !== "hold") {
    message += `Entry: ${entry !== null ? entry.toFixed(4) : "N/A"}\n`;
    message += `Stop Loss: ${stopLoss !== null ? stopLoss.toFixed(4) : "N/A"}\n`;
    message += `Take Profit: ${takeProfit !== null ? takeProfit.toFixed(4) : "N/A"}\n`;
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

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Only POST requests accepted" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const apiKey = request.headers.get("x-api-key");
  if (apiKey !== PRE_SHARED_TOKEN) {
    return new Response(JSON.stringify({ error: "Invalid API key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const inputData = await request.json();
    
    if (!inputData.symbol || !inputData.timeframe || !inputData.ohlc || !inputData.indicators) {
      return new Response(JSON.stringify({ error: "Missing required market data" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const marketData = {
      symbol: inputData.symbol,
      timeframe: inputData.timeframe,
      ohlc: inputData.ohlc,
      indicators: inputData.indicators,
      volume: inputData.volume || 0,
      avgVolume: inputData.avgVolume || inputData.volume || 1,
      keyLevels: inputData.keyLevels || { s1: 0, r1: 0 },
      higherTF: inputData.higherTF || { m15Trend: "neutral" }
    };

    const aiResponse = await analyzeMarket(
      marketData.symbol,
      marketData.timeframe,
      marketData.ohlc,
      marketData.indicators,
      marketData.volume,
      marketData.avgVolume,
      marketData.keyLevels,
      marketData.higherTF.m15Trend
    );

    let signalData;
    try {
      signalData = JSON.parse(aiResponse);
      
      if (!signalData.signal || !signalData.explanation) {
        throw new Error("Invalid AI response format");
      }
      
      signalData.entry = signalData.entry || null;
      signalData.stopLoss = signalData.stopLoss || null;
      signalData.takeProfit = signalData.takeProfit || null;
      signalData.confidence = signalData.confidence || "medium";
      
    } catch (e) {
      console.error("Failed to parse AI response:", e, "Raw response:", aiResponse);
      return new Response(JSON.stringify({ 
        error: "Failed to parse AI response",
        ai_response: aiResponse
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    await sendTelegramAlert(signalData, marketData);

    return new Response(JSON.stringify(signalData), {
      headers: { 
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
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
