// ============================================================
// SUPABASE CLIENT & DATA ACCESS LAYER
// ============================================================

let sbClient = null;

function getSupabase() {
    if (!sbClient) {
        if (typeof supabase === 'undefined' || !supabase.createClient) {
            console.warn('Supabase JS library not loaded via CDN yet.');
            return null;
        }
        sbClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }
    return sbClient;
}

// Local mock storage fallback if network is offline or table creation is pending
const LocalStorageDB = {
    getScans() {
        try {
            return JSON.parse(localStorage.getItem('doca_local_scans') || '[]');
        } catch(e) {
            return [];
        }
    },
    saveScan(scanObj) {
        const scans = this.getScans();
        const existingIdx = scans.findIndex(s => s.id === scanObj.id);
        if (existingIdx >= 0) {
            scans[existingIdx] = scanObj;
        } else {
            scans.unshift(scanObj);
        }
        localStorage.setItem('doca_local_scans', JSON.stringify(scans));
        return scanObj;
    },
    getScanById(id) {
        const scans = this.getScans();
        return scans.find(s => s.id === id) || null;
    }
};

function normalizeAuthenticityStatus(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'authentic' || normalized === 'verified') return 'verified';
    if (normalized.includes('counterfeit') || normalized === 'mismatch') return 'mismatch';
    if (normalized === 'unauthenticated' || normalized === 'unverified') return 'unverified';
    return 'na';
}

function normalizeOverallStatus(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'compliant') return 'compliant';
    if (normalized === 'warning' || normalized === 'partial_compliance') return 'warning';
    if (normalized === 'non_compliant') return 'non_compliant';
    return 'pending';
}

function getActiveMrpValue(mrp) {
    if (!mrp || typeof mrp !== 'object') return mrp || null;
    const activeValue = mrp.replacement_value || mrp.current_value || mrp.active_value
        || (!mrp.original_is_crossed_out ? mrp.value : null);
    if (typeof activeValue !== 'string') return activeValue || null;
    return activeValue.replace(/(Rs\.?|₹)\s*(\d+(?:\.\d+)?)/i, (_, currency, amount) => `${currency} ${Math.round(Number(amount))}`);
}

function toUuid(id) {
    if (!id) return null;
    const str = String(id).trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str)) {
        return str;
    }
    let hex = '';
    for (let i = 0; i < str.length; i++) {
        hex += str.charCodeAt(i).toString(16);
    }
    hex = (hex + '00000000000000000000000000000000').slice(0, 32);
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

function isUuid(id) {
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

const DB = {
    async getCurrentUser() {
        const client = getSupabase();
        if (client) {
            try {
                const { data: { session } } = await client.auth.getSession();
                if (session?.user) {
                    const { data: profile } = await client
                        .from('profiles')
                        .select('*')
                        .eq('id', session.user.id)
                        .maybeSingle();
                    
                    return {
                        id: session.user.id,
                        email: session.user.email,
                        name: profile?.name || session.user.user_metadata?.name || 'Enforcement Officer',
                        role: profile?.role || session.user.user_metadata?.role || 'officer',
                        badge_number: profile?.badge_number || 'LM-IND-01'
                    };
                }
            } catch (err) {
                console.warn('Supabase auth session check:', err);
            }
        }
        return this.getLocalUser();
    },

    getLocalUser() {
        const saved = localStorage.getItem('doca_auth_user');
        if (saved) {
            try { return JSON.parse(saved); } catch(e){}
        }
        return {
            id: 'demo-officer-01',
            email: 'officer.delhi@doca.gov.in',
            name: 'Inspector Rajesh Sharma',
            role: 'officer',
            badge_number: 'LM-DEL-8942'
        };
    },

    setLocalUser(user) {
        localStorage.setItem('doca_auth_user', JSON.stringify(user));
    },

    async saveCompleteScan(scanData, declarations = [], violations = []) {
        const client = getSupabase();
        let rawOfficerId = scanData.officer_id;
        if (!rawOfficerId && client) {
            try {
                const { data: { user } } = await client.auth.getUser();
                rawOfficerId = user?.id || null;
            } catch (e) {
                console.warn('Supabase auth user lookup:', e);
            }
        }
        if (!rawOfficerId) {
            const localUser = DB.getLocalUser();
            rawOfficerId = localUser?.id;
        }
        // Demo/local IDs do not exist in profiles and would violate the FK on scans.officer_id.
        const officerId = isUuid(rawOfficerId) ? rawOfficerId : null;
        const scanId = scanData.id && toUuid(scanData.id)
            ? scanData.id
            : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-' + Date.now().toString().padStart(12, '0'));
        const scanRecord = {
            id: scanId,
            officer_id: officerId,
            barcode: scanData.barcode || null,
            db_product_name: scanData.db_product_name || null,
            db_manufacturer: scanData.db_manufacturer || scanData.brand || null,
            extracted_product_name: scanData.extracted_product_name || scanData.product_name || scanData.vision_raw?.product_name?.value || null,
            extracted_manufacturer: scanData.extracted_manufacturer || scanData.brand || scanData.vision_raw?.manufacturer_name?.value || null,
            extracted_mrp: scanData.extracted_mrp || getActiveMrpValue(scanData.vision_raw?.mrp) || null,
            extracted_address: scanData.extracted_address || scanData.vision_raw?.manufacturer_address?.value || null,
            extracted_mfg_date: scanData.extracted_mfg_date || scanData.vision_raw?.mfg_date?.value || null,
            extracted_net_qty: scanData.extracted_net_qty || scanData.vision_raw?.net_quantity?.value || null,
            extracted_consumer_care: scanData.extracted_consumer_care || scanData.vision_raw?.consumer_care?.value || null,
            extracted_country_origin: scanData.extracted_country_origin || scanData.vision_raw?.country_of_origin?.value || null,
            extracted_language: scanData.extracted_language || scanData.vision_raw?.language_detected || 'English',
            barcode_valid: Boolean(scanData.barcode_valid),
            barcode_registered: Boolean(scanData.barcode_registered),
            image_url: scanData.image_url || null,
            raw_gemini_response: scanData.raw_gemini_response || scanData.vision_raw || {},
            db_raw_response: scanData.db_raw_response || scanData.barcode_data || {},
            overall_status: normalizeOverallStatus(scanData.overall_status || scanData.compliance_status),
            compliance_score: Number(scanData.compliance_score ?? scanData.overall_score ?? 0),
            violation_count: violations.length,
            warning_count: violations.filter(v => v.severity === 'warning').length,
            authenticity_status: normalizeAuthenticityStatus(scanData.authenticity_status),
            authenticity_notes: scanData.authenticity_notes || null,
            created_at: scanData.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        // Cache locally with both raw and mapped officer_id
        const declarationRecords = declarations.map(d => ({
            declaration_type: d.declaration_type || d.rule_ref || 'unknown',
            label: d.label || d.name || 'Declaration',
            rule_reference: d.rule_reference || d.rule_ref || 'Unclassified Check',
            value_extracted: d.value_extracted ?? d.value ?? null,
            confidence: Number(d.confidence || 0),
            present: Boolean(d.present ?? d.value_extracted ?? d.value),
            compliant: d.compliant ?? d.status === 'compliant',
            bounding_box: d.bounding_box || null,
            measured_font_size_mm: d.measured_font_size_mm || null,
            min_required_font_size_mm: d.min_required_font_size_mm || null,
            notes: d.notes || null
        }));
        const violationRecords = violations.map(v => ({
            rule_reference: v.rule_reference || v.rule_ref || 'Compliance Check',
            title: v.title || v.rule_name || 'Compliance Violation',
            description: v.description || 'Statutory requirement not satisfied.',
            severity: ['critical', 'warning', 'info'].includes(v.severity) ? v.severity : 'critical',
            declaration_type: v.declaration_type || null,
            penalty_section: v.penalty_section || v.penalty_provision || null,
            suggestion: v.suggestion || null
        }));

        LocalStorageDB.saveScan({
            ...scanRecord,
            raw_officer_id: rawOfficerId,
            declarations: declarationRecords,
            violations: violationRecords
        });

        if (client) {
            try {
                // Upsert to Supabase
                const { error: scanErr } = await client
                    .from('scans')
                    .upsert([scanRecord]);
                
                if (scanErr) throw scanErr;

                if (declarationRecords.length > 0) {
                    const { error: declarationError } = await client
                        .from('declarations')
                        .insert(declarationRecords.map(d => ({ ...d, scan_id: scanId })));
                    if (declarationError) throw declarationError;
                }

                if (violationRecords.length > 0) {
                    const { error: violationError } = await client
                        .from('violations')
                        .insert(violationRecords.map(v => ({ ...v, scan_id: scanId })));
                    if (violationError) throw violationError;
                }
            } catch (e) {
                console.warn('Syncing to Supabase:', e);
            }
        }

        return scanRecord;
    },

    async getScansList(role = 'officer', userId = null) {
        const client = getSupabase();
        const mappedOfficerUuid = toUuid(userId);

        if (client) {
            try {
                let query = client
                    .from('scans')
                    .select('*, declarations(*), violations(*)')
                    .order('created_at', { ascending: false });
                
                if (role === 'officer' && mappedOfficerUuid) {
                    // Inspectors only see scans where officer_id matches their UUID or demo scans
                    query = query.or(`officer_id.eq.${mappedOfficerUuid},officer_id.is.null`);
                }

                const { data, error } = await query;
                if (error) throw error;
                const remoteScans = data || [];
                const localScans = LocalStorageDB.getScans();
                const merged = new Map();

                [...localScans, ...remoteScans].forEach(scan => {
                    if (scan?.id) merged.set(scan.id, { ...merged.get(scan.id), ...scan });
                });

                return [...merged.values()].sort((a, b) =>
                    new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
                );
            } catch (err) {
                console.error('Supabase getScansList failed:', err);
            }
        }

        const local = LocalStorageDB.getScans();
        if (role === 'officer' && userId) {
            return local.filter(s =>
                s.officer_id === mappedOfficerUuid ||
                s.raw_officer_id === userId ||
                s.officer_id === userId ||
                !s.officer_id
            );
        }
        return local;
    },

    async getScanDetails(scanId) {
        const client = getSupabase();
        if (client) {
            try {
                const { data: scan, error } = await client
                    .from('scans')
                    .select('*, declarations(*), violations(*)')
                    .eq('id', scanId)
                    .maybeSingle();
                
                if (!error && scan) return scan;
            } catch (e) {
                console.warn('Supabase getScanDetails note:', e);
            }
        }

        const local = LocalStorageDB.getScanById(scanId);
        if (local) return local;

        return null;
    },

    getDemoScans() {
        return [
            {
                id: 'scan-demo-001',
                barcode: '8901030383854',
                barcode_type: 'EAN-13',
                barcode_valid: true,
                barcode_registered: true,
                db_product_name: 'Parle-G Gold Biscuits (1 kg)',
                db_manufacturer: 'Parle Products Pvt. Ltd.',
                db_mrp: '₹ 140.00',
                db_source: 'Open Food Facts',
                extracted_product_name: 'Parle-G Gold Biscuits',
                extracted_mrp: '₹ 140.00 (incl. of all taxes)',
                extracted_manufacturer: 'Parle Products Pvt. Ltd., Vile Parle East, Mumbai 400057',
                extracted_address: 'North Level Cross Road, Vile Parle East, Mumbai, Maharashtra 400057',
                extracted_mfg_date: '08/2026',
                extracted_net_qty: '1 kg (1000 g)',
                extracted_consumer_care: '1800-222-211 / cs@parle.biz',
                extracted_language: 'English & Hindi',
                gemini_confidence: 0.96,
                overall_status: 'compliant',
                compliance_score: 98,
                violation_count: 0,
                warning_count: 0,
                authenticity_status: 'verified',
                authenticity_notes: 'Barcode GTIN matches printed product name, manufacturer, and MRP exactly.',
                location: 'Modern Bazaar, Connaught Place, New Delhi',
                store_name: 'Modern Bazaar Supermarket',
                created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
                declarations: [
                    { declaration_type: 'manufacturer_name', label: 'Manufacturer Name', value_extracted: 'Parle Products Pvt. Ltd.', present: true, compliant: true, measured_font_size_mm: 2.2, min_required_font_size_mm: 1.0 },
                    { declaration_type: 'manufacturer_address', label: 'Manufacturer Address', value_extracted: 'Vile Parle East, Mumbai 400057', present: true, compliant: true, measured_font_size_mm: 1.8, min_required_font_size_mm: 1.0 },
                    { declaration_type: 'product_name', label: 'Generic Product Name', value_extracted: 'Biscuits', present: true, compliant: true, measured_font_size_mm: 3.5, min_required_font_size_mm: 1.5 },
                    { declaration_type: 'net_quantity', label: 'Net Quantity', value_extracted: '1 kg', present: true, compliant: true, measured_font_size_mm: 6.2, min_required_font_size_mm: 6.0 },
                    { declaration_type: 'mfg_date', label: 'Month & Year of Mfg', value_extracted: '08/2026', present: true, compliant: true, measured_font_size_mm: 3.0, min_required_font_size_mm: 2.0 },
                    { declaration_type: 'mrp', label: 'Maximum Retail Price', value_extracted: '₹ 140.00 (incl. of all taxes)', present: true, compliant: true, measured_font_size_mm: 6.1, min_required_font_size_mm: 6.0 },
                    { declaration_type: 'consumer_care', label: 'Consumer Care Cell', value_extracted: '1800-222-211 / cs@parle.biz', present: true, compliant: true, measured_font_size_mm: 1.6, min_required_font_size_mm: 1.0 }
                ],
                violations: []
            },
            {
                id: 'scan-demo-002',
                barcode: '8901725134118',
                barcode_type: 'EAN-13',
                barcode_valid: true,
                barcode_registered: true,
                db_product_name: 'Tata Sampann Unpolished Toor Dal (500g)',
                db_manufacturer: 'Tata Consumer Products Ltd.',
                db_mrp: '₹ 125.00',
                db_source: 'Open Food Facts',
                extracted_product_name: 'Special Premium Toor Dal',
                extracted_mrp: '₹ 175.00',
                extracted_manufacturer: 'Shree Balaji Traders Packaging Unit',
                extracted_address: 'GIDC Industrial Estate, Surat, Gujarat',
                extracted_mfg_date: '07/2026',
                extracted_net_qty: '500g',
                extracted_consumer_care: 'Missing phone/email',
                extracted_language: 'English',
                gemini_confidence: 0.91,
                overall_status: 'non_compliant',
                compliance_score: 42,
                violation_count: 3,
                warning_count: 1,
                authenticity_status: 'mismatch',
                authenticity_notes: 'CRITICAL AUTHENTICITY ALERT: Barcode is officially registered to Tata Consumer Products (MRP ₹125), but label displays "Shree Balaji Traders" with inflated MRP ₹175.',
                location: 'Weekly Haat Bazaar, Sector 18, Noida',
                store_name: 'Local Provisions Store',
                created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
                declarations: [
                    { declaration_type: 'manufacturer_name', label: 'Manufacturer Name', value_extracted: 'Shree Balaji Traders', present: true, compliant: false, notes: 'Mismatch with registered barcode brand' },
                    { declaration_type: 'manufacturer_address', label: 'Manufacturer Address', value_extracted: 'GIDC Surat, Gujarat', present: true, compliant: true },
                    { declaration_type: 'product_name', label: 'Generic Product Name', value_extracted: 'Toor Dal', present: true, compliant: true },
                    { declaration_type: 'net_quantity', label: 'Net Quantity', value_extracted: '500g', present: true, compliant: false, measured_font_size_mm: 2.1, min_required_font_size_mm: 4.0, notes: 'Font height is only 2.1mm; required 4.0mm for 500g' },
                    { declaration_type: 'mfg_date', label: 'Month & Year of Mfg', value_extracted: '07/2026', present: true, compliant: true },
                    { declaration_type: 'mrp', label: 'Maximum Retail Price', value_extracted: '₹ 175.00', present: true, compliant: false, notes: 'Missing "(incl. of all taxes)" statement. MRP inflated compared to GTIN registry.' },
                    { declaration_type: 'consumer_care', label: 'Consumer Care Cell', value_extracted: '', present: false, compliant: false, notes: 'Mandatory consumer care telephone & email missing entirely' }
                ],
                violations: [
                    {
                        rule_reference: 'Authenticity Check',
                        title: 'Suspected Counterfeit / Re-labelled Product',
                        description: 'Barcode points to Tata Sampann Toor Dal (MRP ₹125), whereas label declares Shree Balaji Traders with MRP ₹175.',
                        severity: 'critical',
                        penalty_section: 'Section 36(2) of Legal Metrology Act, 2009 & IPC 420 / 482',
                        suggestion: 'Seize batch sample for laboratory verification and issue notice under Rule 27.'
                    },
                    {
                        rule_reference: 'Rule 6(1)(f)',
                        title: 'Improper MRP Declaration Format',
                        description: 'The phrase "(inclusive of all taxes)" or "incl. of all taxes" is absent next to the retail price.',
                        severity: 'critical',
                        penalty_section: 'Section 36(1) of Legal Metrology Act, 2009',
                        suggestion: 'Mandate packaging correction with statutory declaration in next production cycle.'
                    },
                    {
                        rule_reference: 'Rule 6(1)(g)',
                        title: 'Missing Consumer Care Details',
                        description: 'Mandatory grievance officer contact (telephone number and email address) is missing.',
                        severity: 'critical',
                        penalty_section: 'Section 36(1) of Legal Metrology Act, 2009',
                        suggestion: 'Issue compounded notice with penalty under Section 48.'
                    },
                    {
                        rule_reference: 'Rule 7, Table-I',
                        title: 'Net Quantity Numeral Height Substandard',
                        description: 'Measured height of "500g" is 2.1mm. For packages of 200g-500g, statutory minimum numeral height is 4.0mm.',
                        severity: 'warning',
                        penalty_section: 'Section 36(1) of Legal Metrology Act, 2009',
                        suggestion: 'Enlarge numeral typography on Principal Display Panel.'
                    }
                ]
            }
        ];
    }
};

// Aliases for unified calling convention
DB.getProfile = DB.getCurrentUser;
DB.saveScan = function(record) {
    return DB.saveCompleteScan(record, record.declarations || [], record.violations || []);
};

window.DB = DB;
window.SupabaseService = DB;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DB;
}
