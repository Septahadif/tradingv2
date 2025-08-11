const AI_PROXY_ENDPOINT = "https://free.v36.cm/v1/chat/completions";
const MODEL = "gpt-4o-mini";

// Configuration with safe defaults
const TELEGRAM_BOT_TOKEN = globalThis.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = globalThis.TELEGRAM_CHAT_ID || "";
const analysisCache = new Map();
const CACHE_TTL = 60000; // 30 seconds
const DEBUG_MODE = true;

// Enhanced Timeframe Configuration
const TIMEFRAME_CONFIG = {
  M5: {
    ema: { fast: 5, slow: 13 },
    rsi: { overbought: 65, oversold: 35 },
    volume: { spike: 2.0, minConfirm: 1.2 },
    riskReward: 2.0,
    candle: { 
      minSize: 0.3, 
      pinBarWick: 0.6,
      minBodyRatio: 0.1,
      maxNoiseRatio: 0.3
    },
    atrMultiplier: 1.5,
    minCandles: 20
  },
  H1: {
    ema: { fast: 9, slow: 21 },
    rsi: { overbought: 70, oversold: 30 },
    volume: { spike: 1.8, minConfirm: 1.0 },
    riskReward: 1.5,
    candle: { 
      minSize: 0.4, 
      pinBarWick: 0.6,
      minBodyRatio: 0.15,
      maxNoiseRatio: 0.25
    },
    atrMultiplier: 2.0,
    minCandles: 50
  },
  D1: {
    ema: { fast: 21, slow: 50 },
    rsi: { overbought: 75, oversold: 25 },
    volume: { spike: 1.5, minConfirm: 0.8 },
    riskReward: 1.3,
    candle: { 
      minSize: 0.5, 
      pinBarWick: 0.6,
      minBodyRatio: 0.2,
      maxNoiseRatio: 0.2
    },
    atrMultiplier: 2.5,
    minCandles: 30
  }
};

// Debug logger with error tracking
function debugLog(...args) {
  if (DEBUG_MODE) {
    const timestamp = new Date().toISOString();
    try {
      console.log('[DEBUG]', timestamp, ...args);
    } catch (error) {
      console.error('[DEBUG LOG ERROR]', timestamp, error);
    }
  }
}

// Robust Data Validation
function validateTradingData(ohlc, prevCandles, indicators, volume, avgVolume, keyLevels, timeframe) {
  if (!ohlc || typeof ohlc !== 'object') {
    throw new Error("Invalid OHLC data: Must be an object");
  }
  
  const requiredOhlcFields = ['open', 'high', 'low', 'close'];
  for (const field of requiredOhlcFields) {
    if (typeof ohlc[field] !== 'number') {
      throw new Error(`Invalid OHLC data: Missing or invalid ${field} price`);
    }
  }

  if (ohlc.high < ohlc.low) {
    throw new Error("Invalid price range: High cannot be less than Low");
  }

  if (ohlc.high < ohlc.close || ohlc.high < ohlc.open || 
      ohlc.low > ohlc.close || ohlc.low > ohlc.open) {
    throw new Error("Invalid OHLC values: Prices outside high-low range");
  }

  const config = TIMEFRAME_CONFIG[timeframe];
  if (!config) {
    throw new Error(`Invalid timeframe: ${timeframe}. Must be M5, H1, or D1`);
  }

  if (!Array.isArray(prevCandles) || prevCandles.length === 0) {
    throw new Error("prevCandles must be a non-empty array of candles");
}

  if (prevCandles.length < config.minCandles) {
    throw new Error(`Need at least ${config.minCandles} historical candles for ${timeframe}`);
  }

  const requiredIndicators = ['emaFast', 'emaSlow', 'rsi', 'h1Trend'];
  for (const indicator of requiredIndicators) {
    if (indicators[indicator] === undefined) {
      throw new Error(`Missing required indicator: ${indicator}`);
    }
  }

  if (!['bullish', 'bearish', 'neutral'].includes(indicators.h1Trend)) {
    throw new Error(`Invalid H1 trend value: ${indicators.h1Trend}`);
  }

  if (typeof volume !== 'number' || volume <= 0) {
    throw new Error(`Invalid volume: ${volume}. Must be positive number`);
  }

  if (typeof avgVolume !== 'number' || avgVolume <= 0) {
    throw new Error(`Invalid avgVolume: ${avgVolume}. Must be positive number`);
  }

  const requiredKeyLevels = ['s1', 'r1'];
  for (const level of requiredKeyLevels) {
    if (typeof keyLevels[level] !== 'number') {
      throw new Error(`Invalid key level ${level}: ${keyLevels[level]}`);
    }
  }
}

// Enhanced ATR Calculation
function calculateATR(candles, period = 14) {
  if (!candles || !Array.isArray(candles)) return 0;
  if (candles.length < period) {
    period = candles.length; // pakai semua candle yang tersedia
}

  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i-1];
    
    if (!current || !previous) continue;
    
    if (!previous?.close) {
      trueRanges.push(current.high - current.low); // Gunakan range candle saat saja
      continue;
    }
    
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return 0;
  
  // Return smoothed ATR
  return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateDynamicStop(ohlc, prevCandles, timeframe) {
  try {
    const config = TIMEFRAME_CONFIG[timeframe];
    const atr = calculateATR(prevCandles) || (ohlc.high - ohlc.low); // Fallback to candle range
    
    return {
      buy: ohlc.low - (atr * config.atrMultiplier),
      sell: ohlc.high + (atr * config.atrMultiplier),
      takeProfitBuy: ohlc.close + (atr * config.atrMultiplier * 2),
      takeProfitSell: ohlc.close - (atr * config.atrMultiplier * 2),
      atrValue: atr
    };
  } catch (error) {
    debugLog("Dynamic stop error:", error);
    return {
      buy: ohlc.low * 0.995,
      sell: ohlc.high * 1.005,
      takeProfitBuy: ohlc.close * 1.01,
      takeProfitSell: ohlc.close * 0.99,
      atrValue: 0
    };
  }
}

// Session Detection with timezone awareness
function getActiveSession() {
  try {
    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay();
    
    // Weekend check
    if (day === 0 || day === 6) return "Weekend";
    
    // Trading sessions
    if (hour >= 7 && hour < 16) return "London/NY Overlap";
    if (hour >= 0 && hour < 7) return "Asian";
    return "Off";
  } catch (error) {
    debugLog("Session detection error:", error);
    return "Unknown";
  }
}

// News Filter with enhanced validation
function isHighImpactNews(marketContext, symbol) {
  try {
    if (!marketContext || !symbol) return false;
    if (!marketContext.newsEvents || !Array.isArray(marketContext.newsEvents)) return false;
    
    const now = new Date();
    return marketContext.newsEvents.some(event => {
      if (!event || !event.currency || !event.time) return false;
      
      return symbol.toUpperCase().includes(event.currency.toUpperCase()) && 
             event.impact === "high" &&
             Math.abs(now - new Date(event.time)) < 30 * 60 * 1000;
    });
  } catch (error) {
    debugLog("News filter error:", error);
    return false;
  }
}

// Comprehensive Price Action Detection
function detectPriceAction(ohlc, prevCandles, keyLevels, timeframe = 'M5') {
  try {
    const config = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG.M5;
    const bodySize = Math.abs(ohlc.close - ohlc.open);
    const upperWick = ohlc.high - Math.max(ohlc.open, ohlc.close);
    const lowerWick = Math.min(ohlc.open, ohlc.close) - ohlc.low;
    const totalRange = ohlc.high - ohlc.low;
    const avgCandleSize = calculateAverageCandleSize(prevCandles);
    
    // Handle zero range candles
    if (totalRange === 0) {
      return {
        isBullishPin: false,
        isBearishPin: false,
        rejectionAtResistance: false,
        rejectionAtSupport: false,
        strongBullish: false,
        strongBearish: false,
        isNoise: true,
        isDoji: true
      };
    }

    const bodyRatio = bodySize / totalRange;
    const isPinBar = (wick, body) => wick / totalRange > config.candle.pinBarWick && 
                                      body / totalRange < config.candle.minBodyRatio;

    return {
      isBullishPin: isPinBar(lowerWick, bodySize),
      isBearishPin: isPinBar(upperWick, bodySize),
      rejectionAtResistance: ohlc.high > keyLevels.r1 && ohlc.close < keyLevels.r1,
      rejectionAtSupport: ohlc.low < keyLevels.s1 && ohlc.close > keyLevels.s1,
      strongBullish: ohlc.close > ohlc.open && 
                    (ohlc.close - ohlc.open) > (avgCandleSize * config.candle.minSize),
      strongBearish: ohlc.close < ohlc.open && 
                    (ohlc.open - ohlc.close) > (avgCandleSize * config.candle.minSize),
      isNoise: totalRange < (avgCandleSize * config.candle.maxNoiseRatio),
      isDoji: bodyRatio < 0.1,
      breakoutBelowSupport: ohlc.close < keyLevels.s1 && ohlc.open >= keyLevels.s1,
      breakoutAboveResistance: ohlc.close > keyLevels.r1 && ohlc.open <= keyLevels.r1,
      strongBreakout: (ohlc.close < keyLevels.s1 && (ohlc.high - keyLevels.s1) < (keyLevels.s1 - ohlc.low)) || 
                   (ohlc.close > keyLevels.r1 && (keyLevels.r1 - ohlc.low) < (ohlc.high - keyLevels.r1))
    };
  } catch (error) {
    debugLog("Price action detection error:", error);
    return {
      isBullishPin: false,
      isBearishPin: false,
      rejectionAtResistance: false,
      rejectionAtSupport: false,
      strongBullish: false,
      strongBearish: false,
      isNoise: true,
      isDoji: false,
      error: error.message
    };
  }
}

// Enhanced Risk/Reward Calculation
function calculateRiskReward(ohlc, keyLevels, timeframe, prevCandles) {
  try {
    // Validasi tambahan
    if (!ohlc || !keyLevels || !prevCandles) return 0;
    if (keyLevels.s1 >= keyLevels.r1) return 0;
    
    const cfg = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG.M5;
    const atr = Math.max(calculateATR(prevCandles) || (ohlc.high - ohlc.low), 0.0001); // minimal 0.0001
    
    const entry = ohlc.close;
    const mid = (keyLevels.s1 + keyLevels.r1) / 2;

    // Pastikan harga berada dalam range key levels
    if (entry <= keyLevels.s1 || entry >= keyLevels.r1) {
      return cfg.riskReward * 1.5; // Beri bonus RR untuk breakout
    }

    let sl, tp, risk, reward;

    if (entry < mid) {
      sl = Math.min(keyLevels.s1 - (atr * 0.5), ohlc.low - (atr * 0.3));
      tp = keyLevels.r1 + (atr * cfg.atrMultiplier);
      risk = Math.max(entry - sl, 0.0001); // pastikan tidak 0
      reward = Math.max(tp - entry, 0.0001);
    } else {
      sl = Math.max(keyLevels.r1 + (atr * 0.5), ohlc.high + (atr * 0.3));
      tp = keyLevels.s1 - (atr * cfg.atrMultiplier);
      risk = Math.max(sl - entry, 0.0001);
      reward = Math.max(entry - tp, 0.0001);
    }

    const rr = reward / risk;
    return rr > 50 ? 50 : rr; // Batasi RR maksimal 50:1
  } catch (e) {
    debugLog("RR calculation error:", e);
    return 0;
  }
}




// Robust AI Response Parsing
function parseAIResponse(aiText) {
  const defaultResponse = {
    signal: "hold",
    confidence: "low",
    explanation: "Error parsing AI response",
    entry: null,
    stopLoss: null,
    takeProfit: null,
    timeframeContext: "",
    error: null
  };

  try {
    if (!aiText || typeof aiText !== 'string') {
      throw new Error("Empty or invalid AI response");
    }

    const cleaned = aiText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    
    if (!parsed.signal || !["buy", "sell", "hold"].includes(parsed.signal.toLowerCase())) {
      throw new Error("Invalid signal value");
    }
    
    return {
      signal: parsed.signal.toLowerCase(),
      confidence: ["high", "medium", "low"].includes(parsed.confidence?.toLowerCase()) 
                 ? parsed.confidence.toLowerCase() 
                 : "medium",
      explanation: parsed.explanation || "No explanation provided",
      entry: typeof parsed.entry === 'number' ? parsed.entry : null,
      stopLoss: typeof parsed.stopLoss === 'number' ? parsed.stopLoss : null,
      takeProfit: typeof parsed.takeProfit === 'number' ? parsed.takeProfit : null,
      timeframeContext: parsed.timeframeContext || "",
      error: null
    };
  } catch (e) {
    debugLog("AI response parsing failed:", e);
    return {
      ...defaultResponse,
      error: e.message
    };
  }
}

// Comprehensive AI Analysis
async function callAI(symbol, tf, ohlc, prevCandles, indicators, volume, avgVolume, keyLevels, higherTF, marketContext, freev36Key) {
  try {
    validateTradingData(ohlc, prevCandles, indicators, volume, avgVolume, keyLevels, tf);
    
    const config = TIMEFRAME_CONFIG[tf];
    const priceAction = detectPriceAction(ohlc, prevCandles, keyLevels, tf);
    const riskRewardRatio = calculateRiskReward(ohlc, keyLevels, tf, prevCandles);
    const dynamicStop = calculateDynamicStop(ohlc, prevCandles, tf);
    const session = getActiveSession();

    const newsWarning = isHighImpactNews(marketContext, symbol) 
      ? "⚠️ HIGH IMPACT NEWS ACTIVE" 
      : "No high impact news";
    
    const timeframeRules = {
      M5: `M5 TRADING RULES (STRICT):
1. Volume > ${config.volume.spike}x avg (Current: ${(volume/avgVolume).toFixed(1)}x)
2. Min RR ${config.riskReward}:1 (Current: ${riskRewardRatio.toFixed(1)}:1)
3. ${newsWarning}
4. Session: ${session}
5. Must confirm with H1 trend (Current: ${higherTF.h1Trend})
6. Strong rejection or pin bar preferred`,

      H1: `H1 TRADING RULES:
1. Align with D1 trend (Current: ${higherTF.d1Trend})
2. Min RR ${config.riskReward}:1
3. Close confirmation required
4. Volume > ${config.volume.spike}x avg preferred
5. ${newsWarning}`,

      D1: `D1 TRADING RULES:
1. Consider weekly trend
2. Min RR ${config.riskReward}:1
3. Volume confirmation required
4. Major S/R levels preferred
5. ${newsWarning}`
    };

    const technicalContext = `TECHNICAL CONTEXT:
- Price: ${ohlc.close} (Open: ${ohlc.open}, High: ${ohlc.high}, Low: ${ohlc.low})
- EMA${config.ema.fast}: ${indicators.emaFast} ${indicators.emaFast > indicators.emaSlow ? "↑" : "↓"} EMA${config.ema.slow}: ${indicators.emaSlow}
- RSI: ${indicators.rsi} (${indicators.rsi > config.rsi.overbought ? "Overbought" : indicators.rsi < config.rsi.oversold ? "Oversold" : "Neutral"})
- Price Action: ${priceAction.isBullishPin ? "Bullish Pin" : priceAction.isBearishPin ? "Bearish Pin" : priceAction.isDoji ? "Doji" : "Normal"}
- Key Levels: S1=${keyLevels.s1}, R1=${keyLevels.r1}
- Dynamic Stops: Buy=${dynamicStop.buy?.toFixed(5)}, Sell=${dynamicStop.sell?.toFixed(5)}`;

    const payload = {
      model: MODEL,
      messages: [{ 
        role: "user", 
        content: `${timeframeRules[tf]}\n\n${technicalContext}\n\nProvide JSON response with:\n- signal (buy/sell/hold)\n- confidence (high/medium/low)\n- explanation\n- entry\n- stopLoss\n- takeProfit\n- timeframeContext` 
      }],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

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
    
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`AI API Error: ${resp.status} ${errorText}`);
    }
    
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content || "";
  } catch (error) {
    debugLog("AI analysis failed:", error);
    throw error;
  }
}

// Complete Signal Filtering
function filterSignal(parsedSignal, indicators, volume, avgVolume, higherTF, priceAction, riskRewardRatio, timeframe, marketContext, symbol, ohlc, keyLevels) {
  const config = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG.M5;
  const result = { ...parsedSignal };

  // 0. Breakout rules (highest priority)
  if (priceAction.breakoutBelowSupport && volume >= avgVolume * 1.5) {
    return {
      signal: "sell",
      confidence: "high",
      explanation: `Strong breakout below support (S1: ${keyLevels.s1})`,
      entry: ohlc.close,
      stopLoss: ohlc.high,
      takeProfit: keyLevels.s1 - (keyLevels.s1 - ohlc.close) * 1.5
    };
  }

  if (priceAction.breakoutAboveResistance && volume >= avgVolume * 1.5) {
    return {
      signal: "buy",
      confidence: "high",
      explanation: `Strong breakout above resistance (R1: ${keyLevels.r1})`,
      entry: ohlc.close,
      stopLoss: ohlc.low,
      takeProfit: keyLevels.r1 + (ohlc.close - keyLevels.r1) * 1.5
    };
  }

  // 1. News Filter
  if (isHighImpactNews(marketContext, symbol)) {
    return {
      ...result,
      signal: "hold",
      confidence: "low",
      explanation: `${result.explanation} (Rejected: High impact news)`
    };
  }


  // 2. Session Filter
  if (timeframe === 'M5' && getActiveSession() === "Off") {
    return {
      ...result,
      signal: "hold",
      confidence: "low",
      explanation: `${result.explanation} (Rejected: Outside trading hours)`
    };
  }

  // 3. Trend Alignment
  if (result.signal === "buy" && higherTF.h1Trend === "bearish" && timeframe === 'M5') {
    return {
      ...result,
      signal: "hold",
      confidence: "low",
      explanation: `${result.explanation} (Rejected: Against H1 trend)`
    };
  }

  if (result.signal === "sell" && higherTF.h1Trend === "bullish" && timeframe === 'M5') {
    return {
      ...result,
      signal: "hold",
      confidence: "low",
      explanation: `${result.explanation} (Rejected: Against H1 trend)`
    };
  }

  // 4. RSI Filter
  if ((result.signal === "buy" && indicators.rsi > config.rsi.overbought) ||
      (result.signal === "sell" && indicators.rsi < config.rsi.oversold)) {
    if (volume < avgVolume * config.volume.minConfirm) {
      return {
        ...result,
        signal: "hold",
        confidence: "low",
        explanation: `${result.explanation} (Rejected: Extreme RSI without volume confirmation)`
      };
    }
  }

  // 5. Risk/Reward Filter
  if (riskRewardRatio < config.riskReward) {
    return {
      ...result,
      signal: "hold",
      confidence: "low",
      explanation: `${result.explanation} (Rejected: RR ${riskRewardRatio.toFixed(1)}:1 < required ${config.riskReward}:1)`
    };
  }

  // 6. Price Action Boost
  if ((result.signal === "buy" && priceAction.isBullishPin) || 
      (result.signal === "sell" && priceAction.isBearishPin)) {
    return {
      ...result,
      confidence: "high",
      explanation: `${result.explanation} (Confirmed by strong price action)`
    };
  }

  // 7. Noise Filter
  if (priceAction.isNoise) {
    return {
      ...result,
      signal: "hold",
      confidence: "low",
      explanation: "Market noise detected (small candle range)"
    };
  }
  
  // 8. Extreme RSI exception
if (indicators.rsi < 20 && volume >= avgVolume * config.volume.minConfirm) {
  return {
    ...parsedSignal,
    signal: "buy",
    confidence: "high",
    explanation: `Extreme oversold (RSI: ${indicators.rsi}) with volume confirmation`
  };
}

if (indicators.rsi > 80 && volume >= avgVolume * config.volume.minConfirm) {
  return {
    ...parsedSignal,
    signal: "sell",
    confidence: "high",
    explanation: `Extreme overbought (RSI: ${indicators.rsi}) with volume confirmation`
  };
}

  // 9. Revised trend alignment - Extended version
if (higherTF.d1Trend === "bullish") {
  if (higherTF.h1Trend === "bearish") {
    if (parsedSignal.signal === "sell" && indicators.rsi > 40) {
      // Allow sells during bullish D1 if H1 is bearish and not oversold
      return {
        ...parsedSignal,
        explanation: `${parsedSignal.explanation} (Bullish D1 but H1 bearish, RSI ${indicators.rsi} > 40)`
      };
    }
  }
  else if (higherTF.h1Trend === "bullish") {
    if (parsedSignal.signal === "buy" && indicators.rsi < 60) {
      // Strong confirmation for buys when both D1 and H1 bullish
      return {
        ...parsedSignal,
        confidence: "high",
        explanation: `${parsedSignal.explanation} (Confirmed by D1+H1 bullish alignment)`
      };
    }
    else if (parsedSignal.signal === "sell") {
      // Restrict sells during strong bullish alignment
      return {
        ...parsedSignal,
        signal: "hold",
        confidence: "low",
        explanation: "Rejected: Strong bullish alignment (D1+H1)"
      };
    }
  }
}

  return result;
}

// Enhanced Telegram Alert
async function sendTelegramAlert(symbol, timeframe, signal, confidence, explanation, entry, sl, tp, timeframeContext) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    debugLog("Telegram not configured, skipping alert");
    return;
  }

  try {
    const emoji = {
      buy: "🟢 BUY",
      sell: "🔴 SELL",
      hold: "🟡 HOLD"
    }[signal] || "ℹ️";

    const chartUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
    const tradeDetails = signal === "hold" ? "" : `
🎯 Entry: ${entry?.toFixed(5) || "N/A"}
⚠️ Stop: ${sl?.toFixed(5) || "N/A"} 
💰 Target: ${tp?.toFixed(5) || "N/A"}`;

    const message = `
${emoji} | ${symbol} | ${timeframe} | ${confidence.toUpperCase()}
${tradeDetails}
📌 ${explanation}
🔹 ${timeframeContext}
🔹 Time: ${new Date().toUTCString()}
[View Chart](${chartUrl})`;
      
    

    const escapedText = message
  .replace(/\\/g, '\\\\')   // escape backslash dulu, penting supaya nggak kacau
  .replace(/\[/g, '\\[')
  .replace(/\]/g, '\\]')
  .replace(/\(/g, '\\(')
  .replace(/\)/g, '\\)')
  .replace(/\*/g, '\\*')
  .replace(/_/g, '\\_')
  .replace(/`/g, '\\`')
  .replace(/~/g, '\\~')
  .replace(/>/g, '\\>')
  .replace(/#/g, '\\#')
  .replace(/\+/g, '\\+')
  .replace(/-/g, '\\-')
  .replace(/=/g, '\\=')
  .replace(/\|/g, '\\|')
  .replace(/{/g, '\\{')
  .replace(/}/g, '\\}')
  .replace(/\./g, '\\.')
  .replace(/!/g, '\\!');

const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: escapedText, // ✅ Safe
    parse_mode: "MarkdownV2",
    disable_web_page_preview: false
  }),
  timeout: 5000
});

    if (!response.ok) {
      const error = await response.text();
      debugLog("Telegram API error:", error);
    }
  } catch (error) {
    debugLog("Telegram send failed:", error);
  }
}

// Cache Management
function updateCache(cacheKey, data, marketContext) {
  // Invalidate cache during news events
  if (isHighImpactNews(marketContext, data.symbol)) {
    analysisCache.delete(cacheKey);
    return;
  }

  // Standard cache update
  analysisCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    marketContext: JSON.stringify(marketContext) // Store context
  });
}

// Helper Functions
function calculateAverageCandleSize(candles) {
  if (!candles || !Array.isArray(candles)) return 0;
  if (candles.length === 0) return 0;
  
  const sum = candles.reduce((total, candle) => {
    return total + (candle.high - candle.low);
  }, 0);
  
  return sum / candles.length;
}

// Main Request Handler
async function handleRequest(request) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ 
      error: "Method not allowed",
      details: "Only POST requests are supported"
    }), { 
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Authentication
  const apiKey = request.headers.get("x-api-key");
  if (apiKey !== globalThis.PRE_SHARED_TOKEN) {
    return new Response(JSON.stringify({ 
      error: "Unauthorized",
      details: "Invalid API key"
    }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const requestData = await request.json();
    debugLog("Processing request for:", requestData.symbol, requestData.timeframe);

    // Input validation
    if (!requestData.symbol || !requestData.timeframe) {
      throw new Error("Missing required fields: symbol and timeframe");
    }

    const timeframe = requestData.timeframe;
    const cacheKey = `${requestData.symbol}-${timeframe}-${JSON.stringify(requestData.ohlc)}`;
    
    // Cache check
    if (analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        debugLog("Returning cached result");
        return new Response(JSON.stringify(cached.data), {
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Prepare indicators
    const config = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG.M5;
    const indicators = {
  ...(requestData.indicators || {}),
  emaFast: requestData.indicators?.[`ema${config.ema.fast}`],
  emaSlow: requestData.indicators?.[`ema${config.ema.slow}`],
  rsi: requestData.indicators?.rsi,
  h1Trend: requestData.higherTF?.h1Trend || "neutral"
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
      requestData.marketContext || {},
      globalThis.FREEV36_API_KEY || ""
    );

    let parsedSignal = parseAIResponse(aiResponse);
    const priceAction = detectPriceAction(
      requestData.ohlc,
      requestData.prevCandles,
      requestData.keyLevels,
      timeframe
    );
    const riskReward = calculateRiskReward(requestData.ohlc, requestData.keyLevels);
    const dynamicStop = calculateDynamicStop(
      requestData.ohlc,
      requestData.prevCandles,
      timeframe
    );

    // Apply filters
    parsedSignal = filterSignal(
      parsedSignal,
      indicators,
      requestData.volume,
      requestData.avgVolume,
      requestData.higherTF || {},
      priceAction,
      riskReward,
      timeframe,
      requestData.marketContext || {},
      requestData.symbol
    );

    // Enhance with metadata
    parsedSignal.meta = {
      timestamp: new Date().toISOString(),
      session: getActiveSession(),
      newsRisk: isHighImpactNews(requestData.marketContext, requestData.symbol) ? "high" : "low",
      atr: dynamicStop.atrValue,
      timeframeContext: `H1: ${requestData.higherTF?.h1Trend || "unknown"}, D1: ${requestData.higherTF?.d1Trend || "unknown"}`,
      priceAction: {
        isPinBar: priceAction.isBullishPin || priceAction.isBearishPin,
        isRejection: priceAction.rejectionAtResistance || priceAction.rejectionAtSupport
      }
    };

    // Update cache
    updateCache(cacheKey, parsedSignal);

    // Send alert if not hold or if hold with high confidence
    if (parsedSignal.signal !== "hold" || parsedSignal.confidence === "high") {
      await sendTelegramAlert(
        requestData.symbol,
        timeframe,
        parsedSignal.signal,
        parsedSignal.confidence,
        parsedSignal.explanation,
        parsedSignal.entry,
        parsedSignal.stopLoss,
        parsedSignal.takeProfit,
        parsedSignal.meta.timeframeContext
      );
    }

    return new Response(JSON.stringify(parsedSignal), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    debugLog("Request processing failed:", error);
    return new Response(JSON.stringify({ 
      error: "Processing failed",
      details: error.message,
      stack: DEBUG_MODE ? error.stack : undefined
    }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// Cache Cleanup Interval
addEventListener('scheduled', event => {
  event.waitUntil(handleCacheCleanup());
});

async function handleCacheCleanup() {
  const now = Date.now();
  analysisCache.forEach((entry, key) => {
    if (now - entry.timestamp > CACHE_TTL * 2) {
      analysisCache.delete(key);
    }
  });
}

// Worker Event Listener
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});
