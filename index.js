const AI_PROXY_ENDPOINT = "https://free.v36.cm/v1/chat/completions";
const MODEL = "gpt-4o-mini";

// Configuration
const TELEGRAM_BOT_TOKEN = globalThis.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = globalThis.TELEGRAM_CHAT_ID;
const analysisCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

// Timeframe-specific Configuration
const TIMEFRAME_CONFIG = {
  M5: {
    ema: { fast: 5, slow: 13 },
    rsi: { overbought: 65, oversold: 35 },
    volume: { spike: 2.0, minConfirm: 1.2 },
    riskReward: 2.0,
    candle: { minSize: 0.3, pinBarWick: 0.6 }
  },
  H1: {
    ema: { fast: 9, slow: 21 },
    rsi: { overbought: 70, oversold: 30 },
    volume: { spike: 1.8, minConfirm: 1.0 },
    riskReward: 1.5,
    candle: { minSize: 0.4, pinBarWick: 0.6 }
  },
  D1: {
    ema: { fast: 21, slow: 50 },
    rsi: { overbought: 75, oversold: 25 },
    volume: { spike: 1.5, minConfirm: 0.8 },
    riskReward: 1.3,
    candle: { minSize: 0.5, pinBarWick: 0.6 }
  }
};

// Enhanced Data Validation (Unchanged)
function validateTradingData(ohlc, prevCandles, indicators, volume, avgVolume, keyLevels) {
  // ... (existing validation code remains exactly the same)
}

// Enhanced Price Action Detection with Timeframe Awareness
function detectPriceAction(ohlc, prevCandle, keyLevels, timeframe = 'M5') {
  const config = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG.M5;
  const bodySize = Math.abs(ohlc.close - ohlc.open);
  const upperWick = ohlc.high - Math.max(ohlc.open, ohlc.close);
  const lowerWick = Math.min(ohlc.open, ohlc.close) - ohlc.low;
  const totalRange = ohlc.high - ohlc.low;
  const avgCandleSize = calculateAverageCandleSize(prevCandles);

  // Pin Bar Detection with timeframe-specific thresholds
  const isBullishPin = (lowerWick / totalRange > config.candle.pinBarWick) && 
                      (bodySize / totalRange < 0.3);
  const isBearishPin = (upperWick / totalRange > config.candle.pinBarWick) && 
                       (bodySize / totalRange < 0.3);

  // Rejection at Key Levels
  const rejectionAtResistance = ohlc.high > keyLevels.r1 && ohlc.close < keyLevels.r1;
  const rejectionAtSupport = ohlc.low < keyLevels.s1 && ohlc.close > keyLevels.s1;

  return {
    isBullishPin,
    isBearishPin,
    rejectionAtResistance,
    rejectionAtSupport,
    strongBullish: ohlc.close > ohlc.open && 
                  (ohlc.close - ohlc.open) > (avgCandleSize * config.candle.minSize),
    strongBearish: ohlc.close < ohlc.open && 
                  (ohlc.open - ohlc.close) > (avgCandleSize * config.candle.minSize),
    isNoise: totalRange < (avgCandleSize * 0.3) // Only for M5
  };
}

// Risk/Reward Calculation (Unchanged)
function calculateRiskReward(ohlc, keyLevels) {
  if (!ohlc || !keyLevels) return 0;
  const potentialReward = keyLevels.r1 - ohlc.close;
  const potentialRisk = ohlc.close - keyLevels.s1;
  return potentialRisk > 0 ? potentialReward / potentialRisk : 0;
}

// AI Response Parsing (Enhanced with timeframe context)
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
      takeProfit: parsed.takeProfit || null,
      timeframeContext: parsed.timeframeContext || ""
    };
  } catch (e) {
    console.error("Failed to parse AI response:", e);
    return {
      signal: "hold",
      confidence: "low",
      explanation: "Error parsing AI response",
      entry: null,
      stopLoss: null,
      takeProfit: null,
      timeframeContext: ""
    };
  }
}

// Enhanced AI Analysis with Timeframe-Specific Rules
async function callAI(symbol, tf, ohlc, prevCandles, indicators, volume, avgVolume, keyLevels, higherTF, marketContext, freev36Key) {
  validateTradingData(ohlc, prevCandles, indicators, volume, avgVolume, keyLevels);
  
  const config = TIMEFRAME_CONFIG[tf] || TIMEFRAME_CONFIG.M5;
  const priceAction = detectPriceAction(ohlc, prevCandles[0], keyLevels, tf);
  const riskRewardRatio = calculateRiskReward(ohlc, keyLevels);

  const timeframeRules = {
    M5: `M5-SPECIFIC RULES:
1. Require volume > ${config.volume.spike}x average (Current: ${(volume/avgVolume).toFixed(1)}x)
2. Minimum risk/reward ${config.riskReward}:1 (Current: ${riskRewardRatio.toFixed(1)}:1)
3. Strong preference for pin bars at key levels
4. Avoid trading during news events
5. Strictly follow H1 trend direction`,

    H1: `H1-SPECIFIC RULES:
1. Must align with D1 trend (Current: ${higherTF.d1Trend})
2. Minimum risk/reward ${config.riskReward}:1
3. Require closing price confirmation
4. Volume > ${config.volume.spike}x average preferred`,

    D1: `D1-SPECIFIC RULES:
1. Consider weekly trend context
2. Minimum risk/reward ${config.riskReward}:1
3. Require volume confirmation
4. Prefer signals at major support/resistance`
  };

  const userContent = `Act as a professional trading analyst. Strictly follow these rules:
${timeframeRules[tf]}

TREND ANALYSIS:
- EMA${config.ema.fast} ${indicators.emaFast > indicators.emaSlow ? ">" : "<"} EMA${config.ema.slow}
- RSI: ${indicators.rsi} (${indicators.rsi > config.rsi.overbought ? "Overbought" : indicators.rsi < config.rsi.oversold ? "Oversold" : "Neutral"})
- Price Action: ${priceAction.isBullishPin ? "Bullish Pin Bar" : priceAction.isBearishPin ? "Bearish Pin Bar" : "No strong pattern"}
- Key Levels: S1=${keyLevels.s1}, R1=${keyLevels.r1}

Provide JSON response: {
  "signal": "buy/sell/hold",
  "confidence": "high/medium/low",
  "explanation": "...",
  "entry": number,
  "stopLoss": number,
  "takeProfit": number,
  "timeframeContext": "Higher TF confirmation status"
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
    });

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

// Enhanced Signal Filtering with Timeframe Logic
function filterSignal(parsedSignal, indicators, volume, avgVolume, higherTF, priceAction, riskRewardRatio, timeframe = 'M5') {
  const config = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG.M5;

  // Trend Alignment
  if (timeframe === 'M5' && parsedSignal.signal === "buy" && higherTF.h1Trend === "bearish") {
    return {
      ...parsedSignal,
      signal: "hold",
      confidence: "low",
      explanation: `${parsedSignal.explanation} (Rejected: Against H1 trend)`
    };
  }

  if (timeframe === 'H1' && parsedSignal.signal === "buy" && higherTF.d1Trend === "bearish") {
    return {
      ...parsedSignal,
      confidence: "medium",
      explanation: `${parsedSignal.explanation} (Caution: D1 trend bearish)`
    };
  }

  // RSI Filtering
  if ((parsedSignal.signal === "buy" && indicators.rsi > config.rsi.overbought && volume < avgVolume * config.volume.minConfirm) ||
      (parsedSignal.signal === "sell" && indicators.rsi < config.rsi.oversold && volume < avgVolume * config.volume.minConfirm)) {
    return {
      ...parsedSignal,
      signal: "hold",
      confidence: "low",
      explanation: `${parsedSignal.explanation} (Rejected: Extreme RSI without volume)`
    };
  }

  // Risk/Reward Filter
  if (riskRewardRatio < config.riskReward) {
    return {
      ...parsedSignal,
      signal: "hold",
      confidence: "low",
      explanation: `${parsedSignal.explanation} (Rejected: RR ${riskRewardRatio.toFixed(1)}:1 < ${config.riskReward}:1)`
    };
  }

  // Price Action Boost
  if ((parsedSignal.signal === "buy" && priceAction.isBullishPin) || 
      (parsedSignal.signal === "sell" && priceAction.isBearishPin)) {
    return {
      ...parsedSignal,
      confidence: "high",
      explanation: `${parsedSignal.explanation} (Confirmed by ${timeframe} Price Action)`
    };
  }

  // Noise Filter for M5
  if (timeframe === 'M5' && priceAction.isNoise) {
    return {
      ...parsedSignal,
      signal: "hold",
      confidence: "low",
      explanation: "Market noise detected (small candle)"
    };
  }

  return parsedSignal;
}

// Enhanced Telegram Alert with Timeframe Context
async function sendTelegramAlert(symbol, timeframe, signal, confidence, explanation, entry, sl, tp, timeframeContext) {
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
🔹 *Context*: ${timeframeContext}
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
    if (!response.ok) console.error("Telegram error:", await response.text());
  } catch (error) {
    console.error("Failed to send Telegram alert:", error);
  }
}

// Main Handler with Timeframe Support
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
    if (!requestData.symbol || !requestData.timeframe) {
      throw new Error("Missing required fields");
    }

    const timeframe = requestData.timeframe;
    const cacheKey = `${requestData.symbol}-${timeframe}-${JSON.stringify(requestData.ohlc)}`;
    if (analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        return new Response(JSON.stringify(cached.data), {
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Apply timeframe-specific settings
    const config = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG.M5;
    const indicators = {
      ...requestData.indicators,
      emaFast: requestData.indicators[`ema${config.ema.fast}`],
      emaSlow: requestData.indicators[`ema${config.ema.slow}`]
    };

    // Process analysis
    const aiResponse = await callAI(
      requestData.symbol,
      timeframe,
      requestData.ohlc,
      requestData.prevCandles,
      indicators,
      requestData.volume,
      requestData.avgVolume,
      requestData.keyLevels,
      requestData.higherTF,
      requestData.marketContext,
      globalThis.FREEV36_API_KEY
    );

    let parsedSignal = parseAIResponse(aiResponse);
    const priceAction = detectPriceAction(requestData.ohlc, requestData.prevCandles[0], requestData.keyLevels, timeframe);
    const riskReward = calculateRiskReward(requestData.ohlc, requestData.keyLevels);

    parsedSignal = filterSignal(
      parsedSignal,
      indicators,
      requestData.volume,
      requestData.avgVolume,
      requestData.higherTF,
      priceAction,
      riskReward,
      timeframe
    );

    // Add timeframe context
    parsedSignal.timeframeContext = `H1: ${requestData.higherTF.h1Trend}, D1: ${requestData.higherTF.d1Trend}`;

    // Cache and send response
    analysisCache.set(cacheKey, {
      data: parsedSignal,
      timestamp: Date.now()
    });

    await sendTelegramAlert(
      requestData.symbol,
      timeframe,
      parsedSignal.signal,
      parsedSignal.confidence,
      parsedSignal.explanation,
      parsedSignal.entry,
      parsedSignal.stopLoss,
      parsedSignal.takeProfit,
      parsedSignal.timeframeContext
    );

    return new Response(JSON.stringify(parsedSignal), {
      headers: { "Content-Type": "application/json" }
    };

  } catch (error) {
    console.error("Processing error:", error);
    return new Response(JSON.stringify({ 
      error: "Processing failed",
      details: error.message 
    }), { status: 500 });
  }
}

// Helper Functions
function calculateAverageCandleSize(candles) {
  return candles.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / candles.length;
}

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});
