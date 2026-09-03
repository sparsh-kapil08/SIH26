// ============================================================
// CONFIGURATION — Legal Metrology Compliance Checker (Frontend)
// Problem Statement: SIH26034 (DoCA / MoCA)
// Pure Vanilla JS Compatible (No import.meta syntax errors)
// ============================================================

function getEnvVar(name) {
    // 1. Window runtime environment injection (window.ENV_CONFIG)
    if (typeof window !== 'undefined' && window.ENV_CONFIG) {
        if (window.ENV_CONFIG[name]) return window.ENV_CONFIG[name];
        if (window.ENV_CONFIG['VITE_' + name]) return window.ENV_CONFIG['VITE_' + name];
    }

    // 2. Process environment variables
    if (typeof window !== 'undefined' && window.process && window.process.env) {
        if (window.process.env[name]) return window.process.env[name];
        if (window.process.env['VITE_' + name]) return window.process.env['VITE_' + name];
    }

    return null;
}

// Dynamically resolve Backend URL
const DYNAMIC_BACKEND_URL = 
    getEnvVar('VITE_BACKEND_URL') ||
    getEnvVar('BACKEND_URL') ||
    getEnvVar('NEXT_PUBLIC_BACKEND_URL') ||
    (typeof window !== 'undefined' && window.localStorage ? localStorage.getItem('doca_backend_url') : null) ||
    ((typeof window !== 'undefined' && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) 
        ? 'http://localhost:5000' 
        : 'https://sih-26-six.vercel.app/');

const CONFIG = {
    // Backend API Base URL dynamically resolved from environment
    BACKEND_URL: DYNAMIC_BACKEND_URL,

    get VISION_PROXY_URL() {
        return (this.BACKEND_URL || '').replace(/\/$/, '') + '/api/analyze-label';
    },
    get CONFIG_API_URL() {
        return (this.BACKEND_URL || '').replace(/\/$/, '') + '/api/config';
    },

    // Supabase Backend Credentials (resolved from environment with fallback)
    SUPABASE_URL: getEnvVar('VITE_SUPABASE_URL') || getEnvVar('SUPABASE_URL') || 'https://bsajwevjuuvgobaiouuc.supabase.co',
    SUPABASE_ANON_KEY: getEnvVar('VITE_SUPABASE_ANON_KEY') || getEnvVar('SUPABASE_ANON_KEY') || 'sb_publishable_7QJ8KsPhW7Rw__emdD-axA_r4VfezAx',

    // Barcode Product Authenticity Registries
    OPEN_FOOD_FACTS_URL: 'https://world.openfoodfacts.org/api/v2/product/',
    UPCITEMDB_URL: 'https://api.upcitemdb.com/prod/trial/lookup?upc=',

    // Application Metadata
    APP_NAME: 'AI Legal Metrology Compliance & Authenticity Checker',
    APP_CODE: 'SIH26034',
    ORGANIZATION: 'Ministry of Consumer Affairs, Food & Public Distribution',
    DEPARTMENT: 'Department of Consumer Affairs (DoCA)',
    STATUTORY_ACT: 'Legal Metrology Act, 2009 & Packaged Commodities Rules, 2011',

    // Statutory Rules Dictionary (Legal Metrology Packaged Commodities Rules, 2011)
    RULES: {
        RULE_6_1_A: {
            ref: 'Rule 6(1)(a)',
            name: 'Manufacturer / Packer / Importer Identity',
            desc: 'Every package shall bear the name and complete address of the manufacturer or packer or importer.',
            severity: 'critical'
        },
        RULE_6_1_B: {
            ref: 'Rule 6(1)(b)',
            name: 'Country of Origin (Imported Goods)',
            desc: 'For imported goods, the country of origin and complete importer details must be mentioned.',
            severity: 'critical'
        },
        RULE_6_1_C: {
            ref: 'Rule 6(1)(c)',
            name: 'Generic / Common Name of Commodity',
            desc: 'The common or generic name of the commodity contained in the package must be prominently displayed.',
            severity: 'critical'
        },
        RULE_6_1_D: {
            ref: 'Rule 6(1)(d)',
            name: 'Net Quantity Declaration',
            desc: 'Net quantity in standard SI metric units (g, kg, ml, l, or number N/U) must be stated clearly.',
            severity: 'critical'
        },
        RULE_6_1_E: {
            ref: 'Rule 6(1)(e)',
            name: 'Month & Year of Manufacture / Packing',
            desc: 'Month and year of manufacture, packing, or import (or Best Before / Use By date) must be legible.',
            severity: 'critical'
        },
        RULE_6_1_F: {
            ref: 'Rule 6(1)(f)',
            name: 'Maximum Retail Price (MRP) Declaration',
            desc: 'Maximum Retail Price (MRP) in INR inclusive of all taxes must be displayed as "MRP Rs. ... incl. of all taxes" or "MRP ₹... (incl. of all taxes)".',
            severity: 'critical'
        },
        RULE_6_1_G: {
            ref: 'Rule 6(1)(g)',
            name: 'Consumer Care Information',
            desc: 'Name, address, telephone number, and email of the grievance officer/consumer care cell must be provided.',
            severity: 'critical'
        },
        RULE_7_FONT: {
            ref: 'Rule 7',
            name: 'Minimum Font & Numeral Size Standards',
            desc: 'Declarations must adhere to minimum letter and numeral height thresholds according to package weight/volume or Principal Display Panel area.',
            severity: 'critical'
        },
        RULE_8_PDP: {
            ref: 'Rule 8',
            name: 'Principal Display Panel & Free Area',
            desc: 'Mandatory declarations must be grouped on the Principal Display Panel, and the area surrounding net quantity must remain unobstructed.',
            severity: 'warning'
        },
        RULE_9_LANG: {
            ref: 'Rule 9',
            name: 'Language and Legibility Standard',
            desc: 'All declarations must be clearly legible, prominent, and written in Hindi in Devanagari script or English.',
            severity: 'warning'
        },
        AUTH_MISMATCH: {
            ref: 'Authenticity Check',
            name: 'Barcode vs Label Data Inconsistency (Suspected Counterfeit)',
            desc: 'Discrepancy detected between barcode registry data (Open Food Facts / GS1) and printed label information.',
            severity: 'critical'
        }
    },

    // Font-size statutory table (Rule 7, Table-I & Table-II)
    FONT_STANDARDS: {
        MIN_GENERAL_LETTER_MM: 1.0,
        MIN_EMBOSSED_LETTER_MM: 2.0,
        
        BY_NET_QTY: [
            { max_qty: 50, min_numeral_mm: 1.0, min_letter_mm: 1.0 },
            { max_qty: 200, min_numeral_mm: 2.0, min_letter_mm: 1.0 },
            { max_qty: 500, min_numeral_mm: 4.0, min_letter_mm: 1.5 },
            { max_qty: Infinity, min_numeral_mm: 6.0, min_letter_mm: 2.0 }
        ],
        
        BY_PDP_AREA: [
            { max_sqcm: 20, min_numeral_mm: 1.5 },
            { max_sqcm: 100, min_numeral_mm: 2.5 },
            { max_sqcm: 500, min_numeral_mm: 4.0 },
            { max_sqcm: Infinity, min_numeral_mm: 6.0 }
        ]
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
