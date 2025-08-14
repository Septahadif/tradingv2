const AI_PROXY_ENDPOINT = "https://free.v36.cm/v1/chat/completions";
const MODEL = "gpt-4o-mini";

// Konfigurasi
const TELEGRAM_BOT_TOKEN = "7484227045:AAF1CmbY2cOW_7C_NObYCiOGNUNK3Sqehlg";
const TELEGRAM_CHAT_ID = "5026145251";
const PRE_SHARED_TOKEN = "supersecret123";
const FREEV36_API_KEYS = [
    "sk-UdLUDFMEdxwxocNTF77505236a764c8c894bCdE76e239844",
    "sk-vfO24apoNhPF08qN820c1c779305445194Cb5586Bd2c6852"
];

// Key rotation management
let currentApiKeyIndex = 0;
let lastKeyRotation = Date.now();
let rotationLock = false;

async function rotateKey() {
    if (rotationLock) return;
    rotationLock = true;
    try {
        const now = Date.now();
        const sixHours = 6 * 60 * 60 * 1000;
        if (now - lastKeyRotation >= sixHours) {
            currentApiKeyIndex = (currentApiKeyIndex + 1) % FREEV36_API_KEYS.length;
            lastKeyRotation = now;
            console.log(`Rotated to API key index: ${currentApiKeyIndex}`);
        }
    } finally {
        rotationLock = false;
    }
}

function getCurrentApiKey() {
    if (FREEV36_API_KEYS.length === 0) throw new Error("No API keys available");
    return FREEV36_API_KEYS[currentApiKeyIndex];
}

// Enhanced data validation
function validateData(data, tf) {
    if (!data?.ohlc || 
        typeof data.ohlc.close !== 'number' ||
        typeof data.ohlc.open !== 'number' ||
        typeof data.ohlc.high !== 'number' ||
        typeof data.ohlc.low !== 'number') {
        throw new Error(`Invalid ${tf} OHLC structure`);
    }

    return {
        ohlc: data.ohlc,
        ema9: Number(data.indicators?.ema9) || 0,
        ema21: Number(data.indicators?.ema21) || 0,
        rsi: Math.min(Math.max(Number(data.indicators?.rsi) || 50, 0), 100),
        macd: {
            line: Number(data.indicators?.macd?.line) || 0,
            signal: Number(data.indicators?.macd?.signal) || 0
        },
        volume: Math.max(Number(data.volume) || 0, 0)
    };
}

// Secure Markdown formatting
function escapeMarkdown(text) {
    return String(text || "")
        .replace(/\n/g, ' ')
        .replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

async function analyzeMultiTimeframe(symbol, m5Data, m15Data, h1Data) {
    await rotateKey();
    
    try {
        const [m5, m15, h1] = [
            validateData(m5Data, 'M5'),
            validateData(m15Data, 'M15'),
            validateData(h1Data, 'H1')
        ];

        const prompt = `
            Analyze these market conditions and provide pure technical analysis:
            
            Symbol: ${symbol}
            
            H1 (Macro Trend):
            - Price: ${h1.ohlc.close} (O:${h1.ohlc.open} H:${h1.ohlc.high} L:${h1.ohlc.low})
            - EMAs: 9=${h1.ema9.toFixed(4)} | 21=${h1.ema21.toFixed(4)}
            - RSI: ${h1.rsi.toFixed(2)}
            - MACD: Line=${h1.macd.line.toFixed(4)} Signal=${h1.macd.signal.toFixed(4)}
            - Volume: ${h1.volume.toLocaleString()}
            
            M15 (Intermediate):
            - Price: ${m15.ohlc.close.toFixed(4)}
            - EMAs: 9=${m15.ema9.toFixed(4)} | 21=${m15.ema21.toFixed(4)}
            - RSI: ${m15.rsi.toFixed(2)}
            - MACD: Line=${m15.macd.line.toFixed(4)} Signal=${m15.macd.signal.toFixed(4)}
            - Volume: ${m15.volume.toLocaleString()}
            
            M5 (Entry):
            - Price: ${m5.ohlc.close.toFixed(4)}
            - EMAs: 9=${m5.ema9.toFixed(4)} | 21=${m5.ema21.toFixed(4)}
            - RSI: ${m5.rsi.toFixed(2)}
            - MACD: Line=${m5.macd.line.toFixed(4)} Signal=${m5.macd.signal.toFixed(4)}
            - Volume: ${m5.volume.toLocaleString()}

            Provide analysis in JSON format:
            {
                "signal": "buy/sell/wait",
                "reason": "technical_analysis",
                "confidence": "low/medium/high",
                "levels": {
                    "entry": number,
                    "stop": number,
                    "target": number
                },
                "observations": {
                    "trend": "analysis",
                    "momentum": "analysis",
                    "volume": "analysis"
                }
            }
        `;

        const payload = {
            model: MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 400,
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
            throw new Error(`API ${resp.status}: ${await resp.text()}`);
        }

        const data = await resp.json();
        const rawResponse = data.choices[0].message.content;
        
        try {
            const parsed = JSON.parse(rawResponse);
            if (!parsed.signal) throw new Error("Missing signal");
            
            return {
                signal: parsed.signal.toLowerCase(),
                reason: parsed.reason || "No analysis provided",
                confidence: ["low","medium","high"].includes(parsed.confidence) 
                    ? parsed.confidence 
                    : "medium",
                entry: parseFloat(parsed.levels?.entry) || null,
                stopLoss: parseFloat(parsed.levels?.stop) || null,
                takeProfit: parseFloat(parsed.levels?.target) || null,
                observations: {
                    trend: parsed.observations?.trend || "",
                    momentum: parsed.observations?.momentum || "",
                    volume: parsed.observations?.volume || ""
                },
                raw: rawResponse
            };
        } catch (e) {
            console.error("AI Response Parse Error:", rawResponse);
            return {
                signal: "wait",
                reason: `AI parse error: ${e.message}`,
                confidence: "low",
                raw: rawResponse
            };
        }

    } catch (error) {
        console.error("Analysis Error:", error);
        return {
            signal: "wait",
            reason: `Analysis failed: ${error.message}`,
            confidence: "low"
        };
    }
}

async function sendTelegramAlert(signalData, marketData) {
    try {
        const timeString = new Date().toLocaleString('en-US', { 
            timeZone: 'UTC',
            hour12: false 
        }) + " UTC";

        const message = `
            ${signalData.signal === "buy" ? "🟢" : signalData.signal === "sell" ? "🔴" : "🟡"} *${marketData.symbol.toUpperCase()}* \\[${signalData.confidence.toUpperCase()}\\]
            
            *Entry*: \`${signalData.entry?.toFixed(4) || "N/A"}\`
            *Stop*: \`${signalData.stopLoss?.toFixed(4) || "N/A"}\`
            *Target*: \`${signalData.takeProfit?.toFixed(4) || "N/A"}\`
            
            *Trend*: ${escapeMarkdown(signalData.observations.trend)}
            *Momentum*: ${escapeMarkdown(signalData.observations.momentum)}
            *Volume*: ${escapeMarkdown(signalData.observations.volume)}
            
            *Analysis*:
            ${escapeMarkdown(signalData.reason)}
            
            _${timeString}_
        `;

        const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: "MarkdownV2",
                disable_web_page_preview: true
            })
        });

        if (!resp.ok) {
            throw new Error(`Telegram ${resp.status}: ${await resp.text()}`);
        }
    } catch (e) {
        console.error("Telegram Error:", e);
    }
}

async function handleRequest(request) {
    const startTime = Date.now();
    const requestId = request.headers.get('cf-ray') || Math.random().toString(36).substring(7);

    try {
        // Validate method
        if (request.method !== "POST") {
            return new Response(JSON.stringify({ 
                error: "Method not allowed",
                allowed_methods: ["POST"]
            }), { 
                status: 405,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Authenticate
        const auth = request.headers.get("x-api-key");
        if (auth !== PRE_SHARED_TOKEN) {
            return new Response(JSON.stringify({ 
                error: "Unauthorized",
                request_id: requestId
            }), { 
                status: 401,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Parse and validate input
        let inputData;
        try {
            inputData = await request.json();
            if (!inputData?.symbol || !/^[A-Za-z]{3,10}$/.test(inputData.symbol)) {
                throw new Error("Invalid symbol format");
            }
            if (!inputData.m5 || !inputData.m15 || !inputData.h1) {
                throw new Error("Missing timeframe data");
            }
        } catch (e) {
            return new Response(JSON.stringify({ 
                error: "Invalid request body",
                details: e.message,
                request_id: requestId
            }), { 
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Process analysis
        const result = await analyzeMultiTimeframe(
            inputData.symbol,
            inputData.m5,
            inputData.m15,
            inputData.h1
        );

        // Send notification
        await sendTelegramAlert(result, {
            symbol: inputData.symbol,
            timeframe: "M5+M15+H1"
        });

        // Return response
        return new Response(JSON.stringify({
            ...result,
            request_id: requestId,
            processing_time_ms: Date.now() - startTime
        }), {
            status: 200,
            headers: { 
                "Content-Type": "application/json",
                "Cache-Control": "no-store"
            }
        });

    } catch (error) {
        console.error(`Request ${requestId} Error:`, error);
        return new Response(JSON.stringify({ 
            error: "Internal server error",
            request_id: requestId,
            processing_time_ms: Date.now() - startTime
        }), { 
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}

addEventListener("fetch", event => {
    event.respondWith(handleRequest(event.request));
});
