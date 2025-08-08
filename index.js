const AI_PROXY_ENDPOINT = "https://free.v36.cm/v1/chat/completions";
const MODEL = "gpt-4o-mini";

// Configuration
const TELEGRAM_BOT_TOKEN = globalThis.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = globalThis.TELEGRAM_CHAT_ID;
const analysisCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

// Enhanced Data Validation
function validateTradingData(ohlc, prevCandles, indicators, volume, avgVolume, keyLevels) {
  // Validate OHLC structure
  if (!ohlc || typeof ohlc !== 'object') throw new Error("Invalid OHLC data");
  if (ohlc.high < ohlc.low) throw new Error("High price cannot be lower than low price");
  if (ohlc.open < 0 || ohlc.close < 0) throw new Error("Prices cannot be negative");

  // Validate indicators
  if (typeof indicators.rsi !== 'number' || indicators.rsi < 0 || indicators.rsi > 100) {
    throw new Error("Invalid RSI value");
  }
  if (typeof indicators.macd !== 'number' || typeof indicators.macd_signal !== 'number') {
    throw new Error("Invalid MACD values");
  }

  // Validate volume
  if (typeof volume !== 'number' || volume < 0) throw new Error("Invalid volume");
  if (typeof avgVolume !== 'number' || avgVolume <= 0) throw new Error("Invalid average volume");

  // Validate key levels
  if (!keyLevels || typeof keyLevels !== 'object') throw new Error("Invalid key levels data");
  if (typeof keyLevels.s1 !== 'number' || typeof keyLevels.r1 !== 'number') {
    throw new Error("Support/Resistance levels must be numbers");
  }
}

// Price Action Detection
function detectPriceAction(ohlc, prevCandle, keyLevels) {
  const bodySize = Math.abs(ohlc.close - ohlc.open);
  const upperWick = ohlc.high - Math.max(ohlc.open, ohlc.close);
  const lowerWick = Math.min(ohlc.open, ohlc.close) - ohlc.low;
  const totalRange = ohlc.high - ohlc.low;

  // Pin Bar Detection
  const isBullishPin = (lowerWick / totalRange > 0.6) && (bodySize / totalRange < 0.3);
  const isBearishPin = (upperWick / totalRange > 0.6) && (bodySize / totalRange < 0.3);

  // Rejection at Key Levels
  const rejectionAtResistance = ohlc.high > keyLevels.r1 && ohlc.close < keyLevels.r1;
  const rejectionAtSupport = ohlc.low < keyLevels.s1 && ohlc.close > keyLevels.s1;

  return {
    isBullishPin,
    isBearishPin,
    rejectionAtResistance,
    rejectionAtSupport,
    strongBullish: ohlc.close > ohlc.open && (ohlc.close - ohlc.open) > (prevCandle.high - prevCandle.low) * 0.5,
    strongBearish: ohlc.close < ohlc.open && (ohlc.open - ohlc.close) > (prevCandle.high - prevCandle.low) * 0.5
  };
}

// Risk/Reward Calculation
function calculateRiskReward(ohlc, keyLevels) {
  if (!ohlc || !keyLevels) return 0;
  
  const potentialReward = keyLevels.r1 - ohlc.close;
  const potentialRisk = ohlc.close - keyLevels.s1;
  
  // Prevent division by zero
  if (potentialRisk <= 0) return 0;
  
  return potentialReward / potentialRisk;
}

// AI Response Parsing
function parseAIResponse(aiText) {
  try {
    const cleaned = aiText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    
    if (!parsed.signal || !["buy", "sell", "hold"].includes(parsed.signal.toLowerCase())) {
      throw new Error("Invalid signal value");
    }
    
    return {
      signal: parsed.signal.toLowerCase(),
      confidence: parsed.confidence || "medium",
      explanation: parsed.explanation || "No explanation provided",
      entry: parsed.entry || null,
      stopLoss: parsed.stopLoss || null,
      takeProfit: parsed.takeProfit || null
    };
  } catch (e) {
    console.error("Failed to parse AI response:", e);
    return {
      signal: "hold",
      confidence: "low",
      explanation: "Error parsing AI response",
      entry: null,
      stopLoss: null,
      takeProfit: null
    };
  }
}

// Enhanced AI Analysis Function
async function callAI(symbol, tf, ohlc, prevCandles, indicators, volume, avgVolume, keyLevels, higherTF, marketContext, freev36Key) {
  validateTradingData(ohlc, prevCandles, indicators, volume, avgVolume, keyLevels);
  
  const priceAction = detectPriceAction(ohlc, prevCandles[0], keyLevels);
  const riskRewardRatio = calculateRiskReward(ohlc, keyLevels);

  const userContent = `Act as a professional trading analyst. Strictly follow these rules:
  1. Trend Alignment: Never contradict higher timeframe trend (H1/D1).
  2. Price Action: ${priceAction.isBullishPin ? "Bullish Pin Bar detected" : priceAction.isBearishPin ? "Bearish Pin Bar detected" : "No strong pattern"}.
  3. Key Levels: ${priceAction.rejectionAtResistance ? "Rejection at Resistance" : priceAction.rejectionAtSupport ? "Rejection at Support" : "No rejection"}.
  4. Volume Confirmation: Current ${(volume/avgVolume).toFixed(1)}x average volume.
  5. Risk/Reward: ${riskRewardRatio.toFixed(1)}:1 (Minimum 1.5:1 required).

  Current Analysis:
  - Symbol: ${symbol} (${tf})
  - Price: O=${ohlc.open} H=${ohlc.high} L=${ohlc.low} C=${ohlc.close}
  - Trend: EMA9 ${indicators.ema9 > indicators.ema21 ? ">" : "<"} EMA21
  - RSI: ${indicators.rsi} (${indicators.rsi > 70 ? "Overbought" : indicators.rsi < 30 ? "Oversold" : "Neutral"})
  - MACD: ${indicators.macd > indicators.macd_signal ? "Bullish" : "Bearish"} crossover
  - Volume: ${volume > avgVolume * 1.5 ? "HIGH" : "Normal"} (${volume} vs avg ${avgVolume})
  - Key Levels: S1=${keyLevels.s1}, R1=${keyLevels.r1}
  - Higher TF: H1=${higherTF.h1Trend}, D1=${higherTF.d1Trend}
  - Market: ${marketContext.session} session, ${marketContext.volatility} volatility

  Provide JSON response: { 
    "signal": "buy/sell/hold", 
    "confidence": "high/medium/low", 
    "explanation": "...",
    "entry": number,
    "stopLoss": number,
    "takeProfit": number
  }`;

  const payload = {
    model: MODEL,
    messages: [{ role: "user", content: userContent }],
    temperature: 0.1,
    max_tokens: 250,
    response_format: { type: "json_object" }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const resp = await fetch(AI_PROXY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${freev36Key}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    clearTimeout(timeout);
    
    if (!resp.ok) throw new Error(`AI API Error: ${resp.status} ${await resp.text()}`);
    
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content || "";
  } catch (error) {
    clearTimeout(timeout);
    console.error("AI call failed:", error);
    throw error;
  }
}

// Enhanced Signal Filtering
function filterSignal(parsedSignal, indicators, volume, avgVolume, higherTF, priceAction, riskRewardRatio) {
  // Reject against strong trend
  if (parsedSignal.signal === "buy" && higherTF.d1Trend === "strong bearish") {
    return {
      ...parsedSignal,
      signal: "hold",
      confidence: "low",
      explanation: `${parsedSignal.explanation} (Rejected: Against D1 strong trend)`
    };
  }

  // Filter extreme RSI without volume
  if (
    (parsedSignal.signal === "buy" && indicators.rsi > 70 && volume < avgVolume * 1.2) ||
    (parsedSignal.signal === "sell" && indicators.rsi < 30 && volume < avgVolume * 1.2)
  ) {
    return {
      ...parsedSignal,
      signal: "hold",
      confidence: "low",
      explanation: `${parsedSignal.explanation} (Rejected: Extreme RSI without volume)`
    };
  }

  // Filter low risk/reward
  if (riskRewardRatio < 1.5) {
    return {
      ...parsedSignal,
      signal: "hold",
      confidence: "low",
      explanation: `${parsedSignal.explanation} (Rejected: Risk/Reward ${riskRewardRatio.toFixed(1)}:1 too low)`
    };
  }

  // Boost confidence for price action confirmations
  if ((parsedSignal.signal === "buy" && priceAction.isBullishPin) || 
      (parsedSignal.signal === "sell" && priceAction.isBearishPin)) {
    return {
      ...parsedSignal,
      confidence: "high",
      explanation: `${parsedSignal.explanation} (Confirmed by Price Action)`
    };
  }

  return parsedSignal;
}

// Enhanced Telegram Alert with Trade Details
async function sendTelegramAlert(symbol, timeframe, signal, confidence, explanation, entry, sl, tp) {
  const emoji = { buy: "🟢", sell: "🔴", hold: "🟡" }[signal];
  const tradeDetails = signal === "hold" ? "" : `
🎯 Entry: ${entry || "N/A"}
⚠️ Stop Loss: ${sl || "N/A"}
💰 Take Profit: ${tp || "N/A"}`;

  const message = `
${emoji} *${signal.toUpperCase()} Signal* (${confidence} confidence)
📊 *${symbol}* | ${timeframe}
${tradeDetails}
📌 *Reason*: ${explanation}
🔹 *Time*: ${new Date().toUTCString()}`;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown"
      })
    });
    
    if (!response.ok) {
      console.error("Telegram error:", await response.text());
    }
  } catch (error) {
    console.error("Failed to send Telegram alert:", error);
  }
}

// Main Handler
async function handleRequest(request) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  // Auth check
  const apiKey = request.headers.get("x-api-key");
  if (apiKey !== globalThis.PRE_SHARED_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const requestData = await request.json();
    
    // Validate request structure
    if (!requestData.symbol || !requestData.timeframe) {
      throw new Error("Missing required fields");
    }

    // Create cache key
    const cacheKey = `${requestData.symbol}-${requestData.timeframe}-${JSON.stringify(requestData.ohlc)}`;
    if (analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        return new Response(JSON.stringify(cached.data), {
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Process analysis
    const aiResponse = await callAI(
      requestData.symbol,
      requestData.timeframe,
      requestData.ohlc,
      requestData.prevCandles,
      requestData.indicators,
      requestData.volume,
      requestData.avgVolume,
      requestData.keyLevels,
      requestData.higherTF,
      requestData.marketContext,
      globalThis.FREEV36_API_KEY
    );

    let parsedSignal = parseAIResponse(aiResponse);
    const priceAction = detectPriceAction(requestData.ohlc, requestData.prevCandles[0], requestData.keyLevels);
    const riskReward = calculateRiskReward(requestData.ohlc, requestData.keyLevels);

    parsedSignal = filterSignal(
      parsedSignal,
      requestData.indicators,
      requestData.volume,
      requestData.avgVolume,
      requestData.higherTF,
      priceAction,
      riskReward
    );

    // Cache and send response
    analysisCache.set(cacheKey, {
      data: parsedSignal,
      timestamp: Date.now()
    });

    await sendTelegramAlert(
      requestData.symbol,
      requestData.timeframe,
      parsedSignal.signal,
      parsedSignal.confidence,
      parsedSignal.explanation,
      parsedSignal.entry,
      parsedSignal.stopLoss,
      parsedSignal.takeProfit
    );

    return new Response(JSON.stringify(parsedSignal), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Processing error:", error);
    return new Response(JSON.stringify({ 
      error: "Processing failed",
      details: error.message 
    }), { status: 500 });
  }
}

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});
