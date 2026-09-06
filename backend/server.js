require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const SUPPORTED_GEMINI_MODELS = [
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
];
const GEMINI_MODEL = SUPPORTED_GEMINI_MODELS.includes(process.env.GEMINI_MODEL)
    ? process.env.GEMINI_MODEL
    : SUPPORTED_GEMINI_MODELS[0];
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bsajwevjuuvgobaiouuc.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_7QJ8KsPhW7Rw__emdD-axA_r4VfezAx';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        department: 'Department of Consumer Affairs (DoCA)',
        service: 'Legal Metrology Compliance & Vision API',
        version: '1.0.0'
    });
});

app.get('/api/config', (req, res) => {
    res.json({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        geminiModel: GEMINI_MODEL,
        appName: 'AI Legal Metrology Compliance & Authenticity Checker'
    });
});

app.post('/api/analyze-label', async (req, res) => {
    console.log('[Vision API] Request received:', {
        method: req.method,
        hasGeminiApiKey: Boolean(GEMINI_API_KEY),
        model: GEMINI_MODEL,
        imageCount: Array.isArray(req.body?.imageBase64s)
            ? req.body.imageBase64s.length
            : (req.body?.imageBase64 ? 1 : 0)
    });

    try {
        const { imageBase64, imageBase64s, barcodeData } = req.body;
        const images = Array.isArray(imageBase64s) && imageBase64s.length
            ? imageBase64s.slice(0, 4)
            : (imageBase64 ? [imageBase64] : []);

        if (!images.length) {
            return res.status(400).json({ error: 'Missing imageBase64' });
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
Examine all supplied photos of the same packaged commodity and evaluate mandatory declarations under the Legal Metrology Act, 2009 and Legal Metrology (Packaged Commodities) Rules, 2011. Combine evidence across photos: identify the product, manufacturer, quantity, dates, MRP, consumer-care details, and country of origin. When barcode data is absent, identify and match the product using visible packaging text, brand marks, product appearance, and consistent declarations across the photos. Do not treat multiple views as different products unless they conflict; report conflicts in general_observations.
Extract each mandatory declaration and return ONLY a valid, raw JSON object (without markdown fences, raw JSON only).
JSON Schema:
{
  "product_name": { "value": "string or null", "present": true, "confidence": 0.95, "bounding_box": {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.12}, "notes": "string" },
  "manufacturer_name": { "value": "string or null", "present": true, "confidence": 0.90, "bounding_box": {"x": 0.1, "y": 0.65, "w": 0.8, "h": 0.08}, "notes": "string" },
  "manufacturer_address": { "value": "string or null", "present": true, "confidence": 0.88, "bounding_box": {"x": 0.1, "y": 0.74, "w": 0.8, "h": 0.08}, "notes": "string" },
  "net_quantity": { "value": "500g", "present": true, "confidence": 0.94, "unit": "g", "numeric_value": 500, "bounding_box": {"x": 0.1, "y": 0.35, "w": 0.35, "h": 0.08}, "isolated_free_area": true, "notes": "string" },
  "mfg_date": { "value": "08/2026", "present": true, "confidence": 0.90, "bounding_box": {"x": 0.55, "y": 0.35, "w": 0.35, "h": 0.08}, "notes": "string" },
  "mrp": { "value": "Rs. 140.00 (incl. of all taxes)", "present": true, "confidence": 0.95, "numeric_value": 140, "has_tax_inclusion_statement": true, "bounding_box": {"x": 0.1, "y": 0.46, "w": 0.45, "h": 0.09}, "notes": "string" },
  "consumer_care": { "value": "1800-11-4000 / care@doca.gov.in", "present": true, "confidence": 0.89, "has_phone": true, "has_email": true, "bounding_box": {"x": 0.1, "y": 0.84, "w": 0.8, "h": 0.08}, "notes": "string" },
  "country_of_origin": { "value": "India", "present": true, "is_imported": false },
  "importer_details": { "value": null, "present": false },
  "language_detected": "English & Hindi",
  "is_bilingual_or_english_hindi": true,
  "pdp_area_estimate": "Rectangular PDP",
  "font_legibility_rating": "High",
  "general_observations": "Label contains standard mandatory declarations required under Rule 6."
}`;

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        const payload = {
            contents: [{
                parts: [{ text: promptText }, ...imageParts]
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
            model: GEMINI_MODEL,
            status: response.status,
            ok: response.ok
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini API HTTP ${response.status}: ${errText}`);
        }

        const result = await response.json();
        const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        console.log('[Vision API] Gemini result shape:', {
            model: GEMINI_MODEL,
            candidateCount: result.candidates?.length || 0,
            finishReason: result.candidates?.[0]?.finishReason,
            hasContent: Boolean(result.candidates?.[0]?.content),
            hasText: Boolean(rawText),
            promptFeedback: result.promptFeedback
        });
        if (!rawText) throw new Error('Empty response from Gemini Vision');

        let cleanJson = rawText.trim();
        if (cleanJson.startsWith('```json')) cleanJson = cleanJson.slice(7);
        if (cleanJson.startsWith('```')) cleanJson = cleanJson.slice(3);
        if (cleanJson.endsWith('```')) cleanJson = cleanJson.slice(0, -3);
        cleanJson = cleanJson.trim();

        let parsed;
        try {
            parsed = JSON.parse(cleanJson);
        } catch (parseError) {
            console.error('[Vision API] Gemini returned invalid JSON:', {
                parseError: parseError.message,
                rawTextPreview: cleanJson.slice(0, 500)
            });
            throw parseError;
        }
        res.json({
            success: true,
            data: parsed,
            rawResponse: result
        });

    } catch (err) {
        console.error('[Vision API] Request failed:', {
            message: err.message,
            stack: err.stack,
            hasGeminiApiKey: Boolean(GEMINI_API_KEY)
        });
        res.json({
            success: false,
            error: err.message
        });
    }
});

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Backend API running on http://localhost:${PORT}`);
    });
}

module.exports = app;
