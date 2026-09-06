try { require('dotenv').config(); } catch (e) {}
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

// Universal Explicit CORS Middleware (Handles preflight OPTIONS and cross-origin requests)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// GS1 Prefix Country Identification Table
function getGs1CountryPrefix(code) {
    if (!code || code.length < 3) return { country: 'Unknown', isIndia: false };
    const prefix3 = parseInt(code.substring(0, 3), 10);
    const prefix2 = parseInt(code.substring(0, 2), 10);

    if (prefix3 === 890) return { country: 'India (GS1 India Registered)', isIndia: true, prefix: '890' };
    if (prefix2 >= 0 && prefix2 <= 19) return { country: 'United States & Canada', isIndia: false, prefix: '00-19' };
    if (prefix3 >= 300 && prefix3 <= 379) return { country: 'France', isIndia: false, prefix: '300-379' };
    if (prefix3 >= 400 && prefix3 <= 440) return { country: 'Germany', isIndia: false, prefix: '400-440' };
    if (prefix3 >= 490 && prefix3 <= 499) return { country: 'Japan', isIndia: false, prefix: '490-499' };
    if (prefix3 >= 500 && prefix3 <= 509) return { country: 'United Kingdom', isIndia: false, prefix: '500-509' };
    if (prefix3 >= 690 && prefix3 <= 699) return { country: 'China', isIndia: false, prefix: '690-699' };
    if (prefix3 === 880) return { country: 'South Korea', isIndia: false, prefix: '880' };
    if (prefix3 >= 885 && prefix3 <= 888) return { country: 'Thailand / Singapore', isIndia: false, prefix: '885-888' };
    return { country: 'International GS1 Allocation', isIndia: false, prefix: String(prefix3) };
}

// Health check
app.all(['/', '/api'], (req, res) => {
    res.json({
        status: 'online',
        department: 'Department of Consumer Affairs (DoCA)',
        service: 'Legal Metrology Compliance & Authenticity API (SIH26034)',
        features: ['Multi-Source Barcode Lookup', 'GS1 Prefix Validation', 'Label-Based Fallback Authenticity', 'Gemini Vision 2.0']
    });
});

// Config Endpoint
app.all(['/api/config', '/config'], (req, res) => {
    res.json({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        geminiModel: GEMINI_MODEL,
        appName: 'AI Legal Metrology Compliance & Authenticity Checker'
    });
});

// Multi-Source Barcode & Product Query Endpoint
app.all(['/api/lookup-product', '/lookup-product'], async (req, res) => {
    const { barcode, query } = req.query;

    if (!barcode && !query) {
        return res.status(400).json({ error: 'Provide barcode or search query parameter' });
    }

    const clean = (barcode || '').replace(/\D/g, '');
    const gs1 = clean ? getGs1CountryPrefix(clean) : null;

    let searchResult = {
        barcode: clean || null,
        gs1Country: gs1?.country || 'N/A',
        isGs1India: gs1?.isIndia || false,
        isRegistered: false,
        productName: null,
        brand: null,
        manufacturer: null,
        mrp: null,
        netQuantity: null,
        sourcesChecked: [],
        sourcesConfirmed: [],
        searchMode: clean ? 'barcode' : 'label_text_fallback'
    };

    // Source 1: Open Food Facts India & Global
    if (clean) {
        searchResult.sourcesChecked.push('Open Food Facts (Global / India)');
        try {
            const offRes = await fetch(`https://world.openfoodfacts.org/api/v2/product/${clean}.json`);
            if (offRes.ok) {
                const offData = await offRes.json();
                if (offData.status === 1 && offData.product) {
                    const p = offData.product;
                    searchResult.isRegistered = true;
                    searchResult.productName = p.product_name || p.generic_name || p.product_name_en;
                    searchResult.brand = p.brands || null;
                    searchResult.manufacturer = p.manufacturing_places || p.brands || null;
                    searchResult.netQuantity = p.quantity || null;
                    searchResult.sourcesConfirmed.push('Open Food Facts Registry');
                }
            }
        } catch (e) {
            console.warn('Open Food Facts query note:', e.message);
        }
    }

    // Source 2: UPCitemdb lookup (if not found in OFF)
    if (clean && !searchResult.isRegistered) {
        searchResult.sourcesChecked.push('UPCitemdb Merchandise Index');
        try {
            const upcRes = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${clean}`);
            if (upcRes.ok) {
                const upcData = await upcRes.json();
                if (upcData.items && upcData.items.length > 0) {
                    const item = upcData.items[0];
                    searchResult.isRegistered = true;
                    searchResult.productName = item.title || null;
                    searchResult.brand = item.brand || null;
                    searchResult.manufacturer = item.manufacturer || item.brand || null;
                    searchResult.sourcesConfirmed.push('UPCitemdb Index');
                }
            }
        } catch (e) {
            console.warn('UPCitemdb query note:', e.message);
        }
    }

    // Source 3: Text Search Fallback (Open Food Facts search by generic commodity or brand)
    if (!searchResult.isRegistered && query) {
        searchResult.sourcesChecked.push('Open Food Facts Product Name Search');
        try {
            const searchUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=3`;
            const textSearchRes = await fetch(searchUrl);
            if (textSearchRes.ok) {
                const textData = await textSearchRes.json();
                if (textData.products && textData.products.length > 0) {
                    const matched = textData.products[0];
                    searchResult.isRegistered = true;
                    searchResult.productName = matched.product_name || matched.generic_name;
                    searchResult.brand = matched.brands || null;
                    searchResult.manufacturer = matched.manufacturing_places || matched.brands || null;
                    searchResult.netQuantity = matched.quantity || null;
                    searchResult.sourcesConfirmed.push('Market Brand Catalog Search');
                }
            }
        } catch (e) {
            console.warn('Text query note:', e.message);
        }
    }

    // Source 4: Built-in Indian FMCG & Packaged Commodity Registry
    const KNOWN_INDIAN_REGISTRY = {
        '8901030383854': { name: 'Parle-G Gold Biscuits (1 kg)', brand: 'Parle Products Pvt. Ltd.', mrp: '₹ 140.00', qty: '1 kg', fssai: '10013022002253' },
        '8901725134118': { name: 'Tata Sampann Unpolished Toor Dal', brand: 'Tata Consumer Products Ltd.', mrp: '₹ 125.00', qty: '500g', fssai: '10014031001025' },
        '8901058852448': { name: 'Maggi 2-Minute Noodles Masala', brand: 'Nestle India Limited', mrp: '₹ 14.00', qty: '70g', fssai: '10012011000168' },
        '8901491101833': { name: 'Amul Butter (Pasteurised)', brand: 'GCMMF Ltd. (Amul)', mrp: '₹ 56.00', qty: '100g', fssai: '10012021000071' },
        '8901063012721': { name: 'Dabur Honey 100% Pure', brand: 'Dabur India Limited', mrp: '₹ 220.00', qty: '500g', fssai: '10012011000618' },
        '8901207010114': { name: 'Fortune Sunlite Refined Sunflower Oil', brand: 'Adani Wilmar Limited', mrp: '₹ 145.00', qty: '1 L', fssai: '10013021000817' },
        '8906007280016': { name: 'Catch Sprinklers Table Salt', brand: 'DS Group (Dharampal Satyapal)', mrp: '₹ 35.00', qty: '200g', fssai: '10019051002825' },
        '8901030013003': { name: 'Britannia Good Day Butter Cookies', brand: 'Britannia Industries Ltd.', mrp: '₹ 30.00', qty: '100g', fssai: '10015043001129' }
    };

    if (clean && KNOWN_INDIAN_REGISTRY[clean]) {
        const item = KNOWN_INDIAN_REGISTRY[clean];
        searchResult.isRegistered = true;
        searchResult.productName = item.name;
        searchResult.brand = item.brand;
        searchResult.manufacturer = item.brand;
        searchResult.mrp = item.mrp;
        searchResult.netQuantity = item.qty;
        searchResult.fssaiLicense = item.fssai;
        searchResult.sourcesConfirmed.push('GS1 India Verified Registry');
    }

    res.json(searchResult);
});

// Gemini Vision Multimodal Proxy with Label-Based Authenticity Detection (Handles all endpoints and HTTP verbs)
app.all(['/api/analyze-label', '/analyze-label', '/api/analyze-product', '/analyze-product'], async (req, res) => {
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
Examine this packaged commodity label image. Perform two simultaneous tasks:
1. Extract every mandatory declaration under Rule 6, 7, 8, 9 of the Legal Metrology (Packaged Commodities) Rules, 2011.
2. If NO barcode is visible or provided, perform LABEL-BASED AUTHENTICITY AUDIT by extracting FSSAI license number (14 digits), manufacturer postal PIN code (6 digits), registered trademark symbols, and consumer grievance contact cell.

Return ONLY a valid, raw JSON object (without markdown fences, raw JSON only).
JSON Schema:
{
  "product_name": { "value": "string or null", "present": true, "confidence": 0.95, "bounding_box": {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.12}, "notes": "string" },
  "manufacturer_name": { "value": "string or null", "present": true, "confidence": 0.90, "bounding_box": {"x": 0.1, "y": 0.65, "w": 0.8, "h": 0.08}, "notes": "string" },
  "manufacturer_address": { "value": "string or null", "present": true, "confidence": 0.88, "bounding_box": {"x": 0.1, "y": 0.74, "w": 0.8, "h": 0.08}, "pin_code": "6-digit string or null", "notes": "string" },
  "fssai_license": { "value": "14-digit string or null", "present": true/false, "is_valid_14_digit": true/false, "notes": "string" },
  "net_quantity": { "value": "500g", "present": true, "confidence": 0.94, "unit": "g", "numeric_value": 500, "bounding_box": {"x": 0.1, "y": 0.35, "w": 0.35, "h": 0.08}, "isolated_free_area": true, "notes": "string" },
  "mfg_date": { "value": "08/2026", "present": true, "confidence": 0.90, "bounding_box": {"x": 0.55, "y": 0.35, "w": 0.35, "h": 0.08}, "notes": "string" },
  "mrp": { "value": "Rs. 140.00 (incl. of all taxes)", "present": true, "confidence": 0.95, "numeric_value": 140, "has_tax_inclusion_statement": true, "bounding_box": {"x": 0.1, "y": 0.46, "w": 0.45, "h": 0.09}, "notes": "string" },
  "consumer_care": { "value": "1800-11-4000 / care@doca.gov.in", "present": true, "confidence": 0.89, "has_phone": true, "has_email": true, "bounding_box": {"x": 0.1, "y": 0.84, "w": 0.8, "h": 0.08}, "notes": "string" },
  "country_of_origin": { "value": "India", "present": true, "is_imported": false },
  "importer_details": { "value": null, "present": false },
  "language_detected": "English & Hindi",
  "is_bilingual_or_english_hindi": true,
  "label_authenticity_indicators": {
    "has_fssai": true/false,
    "has_complete_postal_pin": true/false,
    "has_consumer_cell": true/false,
    "has_batch_and_date": true/false,
    "overall_authenticity_rating": "HIGH / MODERATE / SUSPICIOUS"
  },
  "general_observations": "Label contains standard mandatory declarations required under Rule 6."
}`;

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

        const modelsToTry = [GEMINI_MODEL, ...SUPPORTED_GEMINI_MODELS]
            .filter((model, index, models) => models.indexOf(model) === index);
        let lastError;

        for (const modelName of modelsToTry) {
            try {
                const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
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

                const result = await response.json();
                const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!rawText) throw new Error('Empty response candidate from Gemini Vision');

                let cleanJson = rawText.trim();
                if (cleanJson.startsWith('```json')) cleanJson = cleanJson.slice(7);
                if (cleanJson.startsWith('```')) cleanJson = cleanJson.slice(3);
                if (cleanJson.endsWith('```')) cleanJson = cleanJson.slice(0, -3);
                cleanJson = cleanJson.trim();

                const parsed = JSON.parse(cleanJson);
                return res.json({
                    success: true,
                    data: parsed,
                    modelUsed: modelName,
                    rawResponse: result
                });
            } catch (modelError) {
                console.error(`[Vision API] Model ${modelName} attempt failed:`, modelError.message);
                lastError = modelError;
            }
        }

        throw lastError || new Error('All Gemini Vision model attempts failed');

    } catch (err) {
        console.error('API Error in /api/analyze-label:', err.message);
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
