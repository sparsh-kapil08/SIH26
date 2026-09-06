const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const SUPPORTED_MODELS = [
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
];
const PRIMARY_MODEL = SUPPORTED_MODELS.includes(process.env.GEMINI_MODEL)
    ? process.env.GEMINI_MODEL
    : SUPPORTED_MODELS[0];

module.exports = async (req, res) => {
    console.log('[Vision API] Request received:', {
        method: req.method,
        hasGeminiApiKey: Boolean(GEMINI_API_KEY),
        model: PRIMARY_MODEL,
        imageCount: Array.isArray(req.body?.imageBase64s)
            ? req.body.imageBase64s.length
            : (req.body?.imageBase64 ? 1 : 0)
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { imageBase64, imageBase64s, barcodeData } = req.body || {};
        const images = Array.isArray(imageBase64s) && imageBase64s.length
            ? imageBase64s.slice(0, 4)
            : (imageBase64 ? [imageBase64] : []);

        if (!images.length) {
            return res.status(400).json({ error: 'Missing imageBase64 in request body' });
        }

        if (images.some(image => typeof image !== 'string')) {
            return res.status(400).json({
                success: false,
                error: 'imageBase64s must contain base64 image strings.'
            });
        }

        if (!GEMINI_API_KEY) {
            console.error('[Vision API] GEMINI_API_KEY is missing.');
            return res.status(503).json({ success: false, error: 'Gemini API key is not configured on the server.' });
        }

        const imageParts = images.map(image => {
            let mimeType = 'image/jpeg';
            let rawBase64 = image;
            const matches = image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
            if (matches) {
                mimeType = matches[1];
                rawBase64 = matches[2];
            }
            return { inline_data: { mime_type: mimeType, data: rawBase64 } };
        });

        const promptText = `You are an expert Legal Metrology Enforcement Inspector for the Department of Consumer Affairs (DoCA), Government of India.
Examine all supplied photos of the same packaged commodity. Combine evidence across photos and match them as one product. When no barcode is provided, identify the product from visible brand marks, packaging text, product appearance, and consistent declarations across the photos; report conflicts instead of using defaults. Perform two simultaneous tasks:
1. Extract every mandatory declaration under Rule 6, 7, 8, 9 of the Legal Metrology (Packaged Commodities) Rules, 2011.
2. If NO barcode is visible or provided, perform LABEL-BASED AUTHENTICITY AUDIT by extracting FSSAI license number (14 digits), manufacturer postal PIN code (6 digits), registered trademark symbols, and consumer grievance contact cell.

Return ONLY a valid, raw JSON object (without markdown fences, raw JSON only).
JSON Schema:
{
  "product_name": { "value": "string or null", "present": true, "confidence": 0.95 },
  "manufacturer_name": { "value": "string or null", "present": true, "confidence": 0.90 },
  "manufacturer_address": { "value": "string or null", "present": true, "confidence": 0.88, "pin_code": "6-digit string or null" },
  "fssai_license": { "value": "14-digit string or null", "present": true/false },
  "net_quantity": { "value": "500g", "present": true, "confidence": 0.94 },
  "mfg_date": { "value": "08/2026", "present": true, "confidence": 0.90 },
  "mrp": { "value": "Rs. 140.00 (incl. of all taxes)", "present": true, "confidence": 0.95, "has_tax_inclusion_statement": true },
  "consumer_care": { "value": "1800-11-4000 / care@doca.gov.in", "present": true }
}`;

        // Fallback models in case primary model is unavailable or 404
        const modelsToTry = [PRIMARY_MODEL, ...SUPPORTED_MODELS].filter((v, i, a) => a.indexOf(v) === i);
        let result = null;
        let lastError = null;

        for (const modelName of modelsToTry) {
            try {
                const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
                const payload = {
                    contents: [{
                        parts: [
                            { text: promptText },
                            ...imageParts
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        topP: 0.95,
                        maxOutputTokens: 2048,
                        responseMimeType: "application/json"
                    }
                };

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                console.log('[Vision API] Gemini response:', {
                    model: modelName,
                    status: response.status,
                    ok: response.ok
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Gemini API (${modelName}) HTTP ${response.status}: ${errText}`);
                }

                const resData = await response.json();
                const rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
                console.log('[Vision API] Gemini result shape:', {
                    model: modelName,
                    candidateCount: resData.candidates?.length || 0,
                    finishReason: resData.candidates?.[0]?.finishReason,
                    hasContent: Boolean(resData.candidates?.[0]?.content),
                    hasText: Boolean(rawText),
                    promptFeedback: resData.promptFeedback
                });
                if (rawText) {
                    let cleanJson = rawText.trim();
                    if (cleanJson.startsWith('```json')) cleanJson = cleanJson.slice(7);
                    if (cleanJson.startsWith('```')) cleanJson = cleanJson.slice(3);
                    if (cleanJson.endsWith('```')) cleanJson = cleanJson.slice(0, -3);
                    cleanJson = cleanJson.trim();

                    try {
                        result = {
                            success: true,
                            data: JSON.parse(cleanJson),
                            modelUsed: modelName,
                            rawResponse: resData
                        };
                    } catch (parseError) {
                        console.error('[Vision API] Gemini returned invalid JSON:', {
                            model: modelName,
                            parseError: parseError.message,
                            rawTextPreview: cleanJson.slice(0, 500)
                        });
                        throw parseError;
                    }
                    break;
                }

                throw new Error(`Gemini returned no text (finishReason: ${resData.candidates?.[0]?.finishReason || 'unknown'})`);
            } catch (err) {
                console.error(`[Vision API] Model ${modelName} attempt failed:`, err.message);
                lastError = err;
            }
        }

        if (result) {
            return res.status(200).json(result);
        }

        throw lastError || new Error('All Gemini Vision model attempts failed');

    } catch (err) {
        console.error('[Vision API] Request failed:', {
            message: err.message,
            stack: err.stack,
            hasGeminiApiKey: Boolean(GEMINI_API_KEY)
        });
        return res.status(200).json({
            success: false,
            error: err.message
        });
    }
};
