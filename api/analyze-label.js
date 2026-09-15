const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const SUPPORTED_MODELS = [
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-flash-latest'
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
            console.warn('[Vision API] GEMINI_API_KEY is not set. Returning demonstration legal metrology extraction data.');
            const demoProductName = barcodeData?.productName || 'Parle-G Gold Biscuits (1 kg)';
            const demoManufacturer = barcodeData?.manufacturer || 'Parle Products Pvt. Ltd.';
            const demoMrp = barcodeData?.mrp || '₹ 140.00';
            const simulatedData = {
                product_name: { value: demoProductName, present: true, confidence: 0.95, bounding_box: { x: 0.1, y: 0.1, w: 0.8, h: 0.12 }, notes: "Prominently displayed on Principal Display Panel" },
                manufacturer_name: { value: demoManufacturer, present: true, confidence: 0.92, bounding_box: { x: 0.1, y: 0.65, w: 0.8, h: 0.08 }, notes: "Registered manufacturer identified" },
                manufacturer_address: { value: "Plot No. 24, Industrial Area, Phase II, New Delhi 110020", present: true, confidence: 0.89, bounding_box: { x: 0.1, y: 0.74, w: 0.8, h: 0.08 }, notes: "Complete postal address identified" },
                net_quantity: { value: "1 kg", present: true, confidence: 0.94, unit: "g", numeric_value: 1000, bounding_box: { x: 0.1, y: 0.35, w: 0.35, h: 0.08 }, isolated_free_area: true, notes: "Prominent numeral declaration with standard unit" },
                mfg_date: { value: "08/2026", present: true, confidence: 0.91, bounding_box: { x: 0.55, y: 0.35, w: 0.35, h: 0.08 }, notes: "Month and year of manufacture declared" },
                mrp: { value: `${demoMrp} (incl. of all taxes)`, present: true, confidence: 0.96, numeric_value: 140, has_tax_inclusion_statement: true, bounding_box: { x: 0.1, y: 0.46, w: 0.45, h: 0.09 }, notes: "Statutory inclusive of all taxes declaration present" },
                consumer_care: { value: "1800-11-4000 / care@doca.gov.in", present: true, confidence: 0.90, has_phone: true, has_email: true, bounding_box: { x: 0.1, y: 0.84, w: 0.8, h: 0.08 }, notes: "Toll-free consumer care contact and email present" },
                country_of_origin: { value: "India", present: true, is_imported: false },
                importer_details: { value: null, present: false },
                language_detected: "English & Hindi",
                is_bilingual_or_english_hindi: true,
                pdp_area_estimate: "Rectangular PDP",
                font_legibility_rating: "High",
                general_observations: "[Demo Mode] Mandatory declarations detected. Add GEMINI_API_KEY to backend/.env for live AI extraction."
            };
            return res.json({
                success: true,
                simulated: true,
                data: simulatedData
            });
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
You analyze photographs of packaged commodity labels under India's Legal Metrology (Packaged Commodities) Rules, 2011. You have complete knowledge of the rule text. Apply it precisely — do not invent requirements not stated here, and do not silently skip a check; if something cannot be determined from the image alone, state so explicitly.

===========================================================================
LEGAL METROLOGY (PACKAGED COMMODITIES) RULES, 2011 REFERENCE
===========================================================================
- Rule 2 Definitions: Net quantity (excluding packaging weight), Retail Sale Price / MRP ("Maximum or Max. retail price Rs.../₹... inclusive of all taxes"), Principal Display Panel (PDP).
- Rule 3 Applicability: Excludes >25kg or >25L packages (except cement/fertilizer up to 50kg) and industrial/institutional packs.
- Rule 4 Pre-packing: Must have secure declarations.
- Rule 5 Standard Package Sizes (Second Schedule): Commodities in Second Schedule must be packed in standard quantities. If non-standard size, label must declare: "Not a standard pack size under the Legal Metrology (Packaged Commodities) Rules, 2011".
- Rule 6 Mandatory Declarations:
  (a) Manufacturer/Packer/Importer Name & Address
  (b) Common/Generic Name of Commodity
  (c) Net Quantity in standard SI metric unit or count
  (d) Month & Year of manufacture/packing/import
  (e) MRP in INR inclusive of all taxes
  (f) Dimensions of commodity if relevant
  (g) Consumer Care Contact: Name, address, telephone number, email
- Rule 7 PDP & Font Sizes: Letter/numeral height thresholds (≥1mm/2mm/4mm/6mm) and width ≥1/3 height.
- Rule 8 PDP Placement & Surrounding Free Space around Net Qty.
- Rule 9 Manner of Declaration: Legibility, color contrast against background, Hindi (Devanagari) or English.
- Rule 10 Full Postal Address with PIN Code.
- Rule 12 Manner of Expressing Quantity. PROHIBITED WORDS: "minimum", "not less than", "average", "about", "approximately", "approx".
- Rule 13 Statement of Units. PROHIBITED UNITS: "dozen", "score", "gross", "lbs", "oz". Use SI metric symbols or count "N"/"U".
- Rules 19-22 & First Schedule (MPE): Maximum Permissible Error requires physical sampling and weighing — CANNOT be assessed from a photograph alone.
- Rule 18 Dealer Obligations: Selling above MRP, scale maintenance — requires physical inspection.

===========================================================================
TASK: RETURN ONLY A RAW VALID JSON OBJECT WITH THIS EXACT SCHEMA:
===========================================================================
{
  "product_name": { "value": "string or null", "present": true, "confidence": 0.95 },
  "manufacturer_name": { "value": "string or null", "present": true, "confidence": 0.90 },
  "manufacturer_address": { "value": "string or null", "present": true, "confidence": 0.88, "pin_code": "6-digit string or null" },
  "packer_name_address": { "value": "string or null", "present": true },
  "importer_name_address": { "value": "string or null", "present": true },
  "generic_name": { "value": "string or null", "present": true },
  "country_of_origin": { "value": "string or null", "present": true },
  "fssai_license": { "value": "14-digit string or null", "present": true },
  "net_quantity": { "value": "500 g", "numeric_val": 500, "unit": "g", "present": true, "confidence": 0.94 },
  "mfg_date": { "value": "08/2026", "present": true, "confidence": 0.90 },
  "mrp": { "value": "Rs. 140.00 (incl. of all taxes)", "numeric_val": 140.00, "present": true, "has_tax_inclusion_statement": true },
  "consumer_care": { "value": "1800-11-4000 / care@doca.gov.in", "present": true },
  "dimensions": { "value": "string or null", "present": true },

  "classification": {
    "commodity_category": "Biscuits | Bread | Butter/margarine | Cereals & pulses | Coffee | Tea | Edible oils/vanaspati/ghee | Milk powder | Rice/flour/atta/rawa/suji | Salt | Toilet soap | Laundry soap | Cement | Aerated soft drinks | Mineral/drinking water | other_unclassified",
    "unit_type": "mass | volume | length | area | number",
    "classification_confidence": 0.95
  },

  "rule_text_checks": {
    "exaggerating_words_found": false,
    "offending_words": [],
    "standard_size_declaration_present": false,
    "mrp_rounding_valid": true,
    "unit_symbol_valid": true,
    "prohibited_units_found": [],
    "out_of_scope_checks": [
      "MPE (Maximum Permissible Error) under Rules 19-22 & First Schedule requires physical laboratory weighing/measuring — cannot be assessed from image alone.",
      "Rule 18 Dealer Obligations (over-charging above MRP, obliteration of MRP, Class III scale maintenance) — requires physical enforcement inspection."
    ]
  }
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
