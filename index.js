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
    if (FREEV36_API_KEYS.length === 0) throw new Error("Tidak ada API key yang tersedia");
    return FREEV36_API_KEYS[currentApiKeyIndex];
}

// Enhanced data validation
function validateData(data, tf) {
  if (!data?.ohlc ||
      typeof data.ohlc.close !== 'number' ||
      typeof data.ohlc.open !== 'number' ||
      typeof data.ohlc.high !== 'number' ||
      typeof data.ohlc.low !== 'number') {
    throw new Error(`Struktur OHLC ${tf} tidak valid`);
  }

  return {
    ohlc: data.ohlc,
    // EMAs untuk M5
    ema5: Number(data.indicators?.ema5) || 0,
    ema9: Number(data.indicators?.ema9) || 0,
    // EMAs untuk M15
    ema12: Number(data.indicators?.ema12) || 0,
    ema21: Number(data.indicators?.ema21) || 0,
    // EMAs untuk H1
    ema50: Number(data.indicators?.ema50) || 0,
    rsi: Math.min(Math.max(Number(data.indicators?.rsi) || 50, 0), 100),
    macd: {
      line: Number(data.indicators?.macd?.line) || 0,
      signal: Number(data.indicators?.macd?.signal) || 0
    },
    adx: Math.min(Math.max(Number(data.indicators?.adx) || 0, 0), 100),
    volume: Math.max(Number(data.volume) || 0, 0)
  };
}

// Enhanced Markdown formatting
function escapeMarkdown(text) {
    if (!text) return "";
    return String(text)
        .replace(/\n/g, ' ')
        .replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1')
        .replace(/\//g, '\\/')
        .substring(0, 4000); // Batasi panjang teks untuk Telegram
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
    Analisis kondisi pasar berikut dan berikan rekomendasi terbaik:
    
    Symbol: ${symbol}
    
    H1 (Trend Makro):
    - Harga: ${h1.ohlc.close} (Buka:${h1.ohlc.open} Tertinggi:${h1.ohlc.high} Terendah:${h1.ohlc.low})
    - ADX(21): ${h1.adx.toFixed(2)}
    - EMA21: ${h1.ema21.toFixed(4)} | EMA50: ${h1.ema50.toFixed(4)}
    - RSI(21): ${h1.rsi.toFixed(2)}
    - MACD(21,50,14): Line=${h1.macd.line.toFixed(4)} Signal=${h1.macd.signal.toFixed(4)}
    - Volume: ${h1.volume.toLocaleString()}
    
    M15 (Menengah):
    - Harga: ${m15.ohlc.close.toFixed(4)}
    - ADX(14): ${m15.adx.toFixed(2)}
    - EMA12: ${m15.ema12.toFixed(4)} | EMA21: ${m15.ema21.toFixed(4)}
    - RSI(14): ${m15.rsi.toFixed(2)}
    - MACD(12,26,9): Line=${m15.macd.line.toFixed(4)} Signal=${m15.macd.signal.toFixed(4)}
    - Volume: ${m15.volume.toLocaleString()}
    
    M5 (Entry):
    - Harga: ${m5.ohlc.close.toFixed(4)}
    - ADX(10): ${m5.adx.toFixed(2)}
    - EMA5: ${m5.ema5.toFixed(4)} | EMA9: ${m5.ema9.toFixed(4)}
    - RSI(9): ${m5.rsi.toFixed(2)}
    - MACD(8,17,9): Line=${m5.macd.line.toFixed(4)} Signal=${m5.macd.signal.toFixed(4)}
    - Volume: ${m5.volume.toLocaleString()}

    Berikan analisis dalam format JSON:
    {
        "signal": "beli/jual/tunggu",
        "reason": "analisis_teknikal",
        "confidence": "rendah/sedang/tinggi",
        "levels": {
            "entry": number,
            "stop": number,
            "target": number
        },
        "observations": {
            "trend": "analisis",
            "momentum": "analisis",
            "volume": "analisis",
            "trend_strength": "analisis" // berdasarkan ADX
        }
    }
`;

        const payload = {
            model: MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 500,
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
            throw new Error(`Error API ${resp.status}: ${await resp.text()}`);
        }

        const data = await resp.json();
        const rawResponse = data.choices[0].message.content;
        
        try {
            const parsed = JSON.parse(rawResponse);
            if (!parsed.signal) throw new Error("Signal tidak ditemukan");
            
            // Enhanced normalization
            const normalizedSignal = String(parsed.signal).toLowerCase().trim();
            const normalizedConfidence = String(parsed.confidence).toLowerCase().trim();
            
            const signalMap = {
                'beli': 'buy',
                'jual': 'sell',
                'tunggu': 'wait'
            };
            
            const confidenceMap = {
                'rendah': 'low',
                'sedang': 'medium',
                'tinggi': 'high'
            };

            return {
                signal: signalMap[normalizedSignal] || 'wait',
                reason: parsed.reason || "Tidak ada analisis yang diberikan",
                confidence: confidenceMap[normalizedConfidence] || 'medium',
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
            console.error("Error parsing respons AI:", rawResponse);
            return {
                signal: "wait",
                reason: `Error parsing AI: ${e.message}`,
                confidence: "low",
                raw: rawResponse
            };
        }

    } catch (error) {
        console.error("Error analisis:", error);
        return {
            signal: "wait",
            reason: `Gagal analisis: ${error.message}`,
            confidence: "low"
        };
    }
}

async function sendTelegramAlert(signalData, marketData) {
    console.log("[Telegram] Memulai proses pengiriman notifikasi", {
        signalData: JSON.stringify(signalData),
        marketData: JSON.stringify(marketData)
    });

    try {
        const timeString = new Date().toLocaleString('id-ID', { 
            timeZone: 'Asia/Jakarta',
            hour12: false 
        });

        // Enhanced signal mapping
        const signalText = {
            'buy': '🟢 BELI',
            'sell': '🔴 JUAL', 
            'wait': '🟡 TUNGGU'
        }[signalData.signal.toLowerCase()] || '🟡 TUNGGU';

        // Format message dengan escape yang lebih ketat
        const message = `
${signalText} *${escapeMarkdown(marketData.symbol.toUpperCase())}* \\[${escapeMarkdown(signalData.confidence.toUpperCase())}\\]

*Entry*: \`${signalData.entry?.toFixed(4) || "N/A"}\`
*Stop Loss*: \`${signalData.stopLoss?.toFixed(4) || "N/A"}\`
*Take Profit*: \`${signalData.takeProfit?.toFixed(4) || "N/A"}\`

*Trend*:
${escapeMarkdown(signalData.observations.trend)}

*Momentum*:
${escapeMarkdown(signalData.observations.momentum)}

*Volume*:
${escapeMarkdown(signalData.observations.volume)}

*Analisis*:
${escapeMarkdown(signalData.reason)}

_${escapeMarkdown(timeString)} WIB_
        `.trim();

        console.log("[Telegram] Pesan yang akan dikirim:", message);

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

        const responseData = await resp.json();
        console.log("[Telegram] Response:", resp.status, responseData);

        if (!resp.ok) {
            throw new Error(`Error Telegram ${resp.status}: ${JSON.stringify(responseData)}`);
        }

        return true;
    } catch (e) {
        console.error("[Telegram] Error detail:", {
            message: e.message,
            stack: e.stack,
            signalData,
            marketData
        });
        return false;
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

        // Send notification with enhanced logging
        const notificationSent = await sendTelegramAlert(result, {
            symbol: inputData.symbol,
            timeframe: "M5+M15+H1"
        });

        // Return response with notification status
        return new Response(JSON.stringify({
            ...result,
            notification_sent: notificationSent,
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
