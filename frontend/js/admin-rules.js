// ============================================================
// ADMIN RULES MANAGEMENT CONTROLLER
// CRUD for compliance_rules, prohibited_words, pack_sizes tables
// ============================================================

let allRules = [];
let deleteTargetId = null;

// ── Null-safe Supabase helper ────────────────────────────────
function db() {
    const c = getSupabase();
    if (!c) throw new Error('Supabase client is not initialised. Check CDN load order.');
    return c;
}

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const user = await DB.getCurrentUser();
    if (!user || user.role !== 'admin') {
        alert('Access denied. This page is restricted to Admins only.');
        window.location.href = 'dashboard.html';
        return;
    }
    const nameEl = document.getElementById('userNameDisplay');
    if (nameEl) nameEl.textContent = user.name || 'Admin';

    setupTabs();
    await loadAllRules();
    await loadProhibitedWords();
    await loadPackSizes();
});

// ── Tab Switcher ─────────────────────────────────────────────
function setupTabs() {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const panel = document.getElementById('tab-' + btn.dataset.tab);
            if (panel) panel.classList.add('active');
        });
    });
}

// ── Load Rules ───────────────────────────────────────────────
async function loadAllRules() {
    let client;
    try { client = db(); } catch (_) {
        console.warn('Supabase not ready, using built-in defaults.');
        allRules = getDefaultRules();
        renderRulesTab('mandatory_declaration');
        renderRulesTab('format_rule');
        return;
    }
    try {
        const { data, error } = await client
            .from('compliance_rules')
            .select('*')
            .order('rule_reference', { ascending: true });
        if (error) throw error;
        allRules = (data && data.length > 0) ? data : [];
        if (allRules.length === 0) {
            allRules = getDefaultRules();
            await seedDefaultRules(allRules);
        }
    } catch (err) {
        console.warn('Supabase load failed, seeding defaults:', err);
        allRules = getDefaultRules();
        await seedDefaultRules(allRules);
    }
    renderRulesTab('mandatory_declaration');
    renderRulesTab('format_rule');
}

function getDefaultRules() {
    const defaults = [
        { rule_reference: 'Rule 6(1)(a)', name: 'Manufacturer / Packer / Importer Identity', description: 'Every package shall bear the name and complete postal address of the manufacturer, packer, or importer.', category: 'mandatory_declaration', severity: 'critical', score_deduction: 20, penalty_section: 'Section 36(1) of Legal Metrology Act, 2009', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Print full manufacturer name and address with PIN code on the label.', is_active: true },
        { rule_reference: 'Rule 6(1)(b)', name: 'Country of Origin (Imported Goods)', description: 'For imported goods, country of origin and complete importer address must be stated.', category: 'mandatory_declaration', severity: 'critical', score_deduction: 15, penalty_section: 'Section 36(1) of Legal Metrology Act, 2009', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Add "Country of Origin: [Country]" and full importer address.', is_active: true },
        { rule_reference: 'Rule 6(1)(c)', name: 'Generic / Common Name of Commodity', description: 'The common or generic name of the commodity must be prominently displayed on the package.', category: 'mandatory_declaration', severity: 'critical', score_deduction: 15, penalty_section: 'Section 36(1) of Legal Metrology Act, 2009', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Ensure the product generic name is clearly printed on the Principal Display Panel.', is_active: true },
        { rule_reference: 'Rule 6(1)(d)', name: 'Net Quantity Declaration', description: 'Net quantity in standard SI metric units (g, kg, ml, l, or number N/U) must be stated.', category: 'mandatory_declaration', severity: 'critical', score_deduction: 20, penalty_section: 'Section 36(1) of Legal Metrology Act, 2009', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Declare net weight or volume in SI metric units clearly on the package.', is_active: true },
        { rule_reference: 'Rule 6(1)(e)', name: 'Month & Year of Manufacture / Packing', description: 'Month and year of manufacture, packing, or import must be legibly printed.', category: 'mandatory_declaration', severity: 'critical', score_deduction: 15, penalty_section: 'Section 36(1) of Legal Metrology Act, 2009', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Print manufacturing/packing date in MM/YYYY format clearly on the package.', is_active: true },
        { rule_reference: 'Rule 6(1)(f)', name: 'Maximum Retail Price (MRP) Declaration', description: 'MRP in INR inclusive of all taxes must be displayed as "MRP Rs. ... (incl. of all taxes)".', category: 'mandatory_declaration', severity: 'critical', score_deduction: 20, penalty_section: 'Section 36(1) of Legal Metrology Act, 2009', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Print MRP with the phrase "inclusive of all taxes" clearly.', is_active: true },
        { rule_reference: 'Rule 6(1)(g)', name: 'Consumer Care Contact Information', description: 'Name, address, phone, and email of the consumer grievance officer must be provided.', category: 'mandatory_declaration', severity: 'critical', score_deduction: 15, penalty_section: 'Section 36(1) of Legal Metrology Act, 2009', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Add a dedicated consumer care helpline number and email address.', is_active: true },
        { rule_reference: 'Rule 5', name: 'Second Schedule Standard Pack Size', description: 'Products in Second Schedule categories must use standard pack sizes or carry the mandatory non-standard size disclaimer.', category: 'format_rule', severity: 'critical', score_deduction: 15, penalty_section: 'Section 36(1) of Legal Metrology Act, 2009', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Use a standard pack size or print the mandatory Second Schedule disclaimer.', is_active: true },
        { rule_reference: 'Rule 7', name: 'Minimum Font & Numeral Size Standards', description: 'Declarations must adhere to minimum letter and numeral height thresholds per package weight/PDP area.', category: 'format_rule', severity: 'critical', score_deduction: 10, penalty_section: 'Section 36(1) of Legal Metrology Act, 2009', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Increase font size to meet Rule 7 Table-I and Table-II minimum height requirements.', is_active: true },
        { rule_reference: 'Rule 8', name: 'Principal Display Panel & Free Space', description: 'Mandatory declarations must be grouped on the PDP, and surrounding free space around net quantity must be unobstructed.', category: 'format_rule', severity: 'warning', score_deduction: 10, penalty_section: 'Rule 8 advisory notice', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Ensure all mandatory declarations appear on the PDP with clear surrounding space.', is_active: true },
        { rule_reference: 'Rule 9', name: 'Language and Legibility Standard', description: 'All declarations must be clearly legible, prominent, and written in Hindi (Devanagari) or English.', category: 'format_rule', severity: 'warning', score_deduction: 10, penalty_section: 'Rule 9 advisory notice', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Improve contrast, readability, and ensure declarations are in Hindi or English.', is_active: true },
        { rule_reference: 'Rule 10', name: 'Full Postal Address & PIN Code', description: 'Package must show a complete postal address of manufacturer/packer with a valid 6-digit PIN code.', category: 'format_rule', severity: 'critical', score_deduction: 10, penalty_section: 'Section 36(1) of Legal Metrology Act, 2009', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Print complete manufacturer address including valid 6-digit postal PIN code.', is_active: true },
        { rule_reference: 'Rule 12', name: 'Prohibited Exaggerating Quantity Words', description: 'Vague/exaggerating words like "minimum", "not less than", "approximately" are strictly prohibited in quantity declarations.', category: 'format_rule', severity: 'critical', score_deduction: 20, penalty_section: 'Section 36(1) of Legal Metrology Act, 2009 (Fine up to Rs.25,000)', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Remove all vague quantity expressions and state exact measured quantities only.', is_active: true },
        { rule_reference: 'Rule 13', name: 'Statement of SI Metric Units', description: 'Quantity must be declared in standard SI metric units (g, kg, ml, l, m, cm) or count N/U. Non-metric units prohibited.', category: 'format_rule', severity: 'critical', score_deduction: 15, penalty_section: 'Section 36(1) of Legal Metrology Act, 2009', statutory_act: 'Legal Metrology (Packaged Commodities) Rules, 2011', suggestion: 'Replace non-metric units (lbs, oz, dozen) with SI metric equivalents.', is_active: true },
    ];
    const makeUuid = (idx) => '00000000-0000-4000-8000-' + (idx + 1).toString(16).padStart(12, '0');
    return defaults.map((r, i) => ({ ...r, id: makeUuid(i), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
}

async function seedDefaultRules(rules) {
    let client;
    try { client = db(); } catch (_) { return; }
    try {
        const toInsert = rules.map(({ id, ...rest }) => rest);
        const { error } = await client.from('compliance_rules').upsert(toInsert, { onConflict: 'rule_reference' });
        if (error) { console.warn('Seed upsert error:', error); return; }
        const { data } = await client.from('compliance_rules').select('*').order('rule_reference');
        if (data) allRules = data;
    } catch (e) { /* silent */ }
}

// ── Render Rules Tab ─────────────────────────────────────────
function renderRulesTab(category) {
    const isDecl = category === 'mandatory_declaration';
    const searchQuery = (document.getElementById(isDecl ? 'searchDecl' : 'searchFmt')?.value || '').toLowerCase();
    const severityFilter = isDecl ? (document.getElementById('filterSeverityDecl')?.value || 'all') : 'all';
    const activeFilter = isDecl ? (document.getElementById('filterActiveDecl')?.value || 'all') : 'all';
    const containerId = isDecl ? 'declRulesList' : 'fmtRulesList';

    let filtered = allRules.filter(r => r.category === category);
    if (searchQuery) filtered = filtered.filter(r => (r.rule_reference + ' ' + r.name).toLowerCase().includes(searchQuery));
    if (severityFilter !== 'all') filtered = filtered.filter(r => r.severity === severityFilter);
    if (activeFilter !== 'all') filtered = filtered.filter(r => String(r.is_active) === activeFilter);

    const container = document.getElementById(containerId);
    if (!container) return;

    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="emoji">📋</div><h4>No rules found.</h4><p>Click "+ Add New Rule" to create one.</p></div>';
        return;
    }

    container.innerHTML = filtered.map(rule => `
        <div class="rule-card">
            <div class="rule-card-header">
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; min-width:0;">
                    <span class="rule-ref-badge">${escHtml(rule.rule_reference)}</span>
                    <strong style="color:var(--text-primary); font-size:0.95rem;">${escHtml(rule.name)}</strong>
                    <span class="rule-ref-badge severity-${escHtml(rule.severity)}">${escHtml(rule.severity).toUpperCase()}</span>
                    <span class="${rule.is_active ? 'active-badge' : 'inactive-badge'}">${rule.is_active ? 'Active' : 'Inactive'}</span>
                    <span class="rule-score-tag">-${rule.score_deduction || 0} pts</span>
                </div>
                <div class="rule-actions">
                    <button class="btn btn-sm btn-outline-primary" onclick="openEditRuleModal('${escHtml(String(rule.id))}')">Edit</button>
                    <button class="btn btn-sm" style="background:#FEF2F2; color:#B91C1C; border:1px solid #FCA5A5;"
                        onclick="openDeleteModal('${escHtml(String(rule.id))}', '${escHtml(rule.rule_reference + ' - ' + rule.name)}')">Delete</button>
                    <button class="btn btn-sm ${rule.is_active ? 'btn-warning' : 'btn-success'}"
                        onclick="toggleRuleActive('${escHtml(String(rule.id))}', ${!rule.is_active})">
                        ${rule.is_active ? 'Disable' : 'Enable'}
                    </button>
                </div>
            </div>
            <div style="font-size:0.88rem; color:var(--text-secondary);">${escHtml(rule.description || '')}</div>
            ${rule.suggestion ? '<div class="rule-meta"><strong>Suggestion:</strong> ' + escHtml(rule.suggestion) + '</div>' : ''}
            ${rule.penalty_section ? '<div class="rule-meta"><strong>Penalty:</strong> ' + escHtml(rule.penalty_section) + '</div>' : ''}
        </div>
    `).join('');
}

// ── Toggle Active ────────────────────────────────────────────
async function toggleRuleActive(id, newState) {
    let client;
    try { client = db(); } catch (e) { showToast('Supabase not ready.', 'error'); return; }
    try {
        const { error } = await client
            .from('compliance_rules')
            .update({ is_active: newState, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
        const rule = allRules.find(r => r.id === id);
        if (rule) rule.is_active = newState;
        renderRulesTab('mandatory_declaration');
        renderRulesTab('format_rule');
        showToast('Rule ' + (newState ? 'enabled' : 'disabled') + ' successfully.', 'success');
    } catch (err) {
        showToast('Failed to update rule status.', 'error');
    }
}

// ── Add / Edit Rule Modal ────────────────────────────────────
function openAddRuleModal() {
    document.getElementById('ruleModalTitle').textContent = 'Add New Compliance Rule';
    document.getElementById('ruleId').value = '';
    document.getElementById('ruleRef').value = '';
    document.getElementById('ruleCategory').value = 'mandatory_declaration';
    document.getElementById('ruleName').value = '';
    document.getElementById('ruleDesc').value = '';
    document.getElementById('ruleSeverity').value = 'critical';
    document.getElementById('ruleScoreDeduction').value = '15';
    document.getElementById('rulePenaltySection').value = 'Section 36(1) of Legal Metrology Act, 2009';
    document.getElementById('ruleStatutoryAct').value = 'Legal Metrology (Packaged Commodities) Rules, 2011';
    document.getElementById('ruleSuggestion').value = '';
    document.getElementById('ruleIsActive').checked = true;
    document.getElementById('ruleModal').style.display = 'flex';
}

function openEditRuleModal(id) {
    const rule = allRules.find(r => String(r.id) === String(id));
    if (!rule) return;
    document.getElementById('ruleModalTitle').textContent = 'Edit Compliance Rule';
    document.getElementById('ruleId').value = rule.id;
    document.getElementById('ruleRef').value = rule.rule_reference || '';
    document.getElementById('ruleCategory').value = rule.category || 'mandatory_declaration';
    document.getElementById('ruleName').value = rule.name || '';
    document.getElementById('ruleDesc').value = rule.description || '';
    document.getElementById('ruleSeverity').value = rule.severity || 'critical';
    document.getElementById('ruleScoreDeduction').value = rule.score_deduction || 15;
    document.getElementById('rulePenaltySection').value = rule.penalty_section || '';
    document.getElementById('ruleStatutoryAct').value = rule.statutory_act || '';
    document.getElementById('ruleSuggestion').value = rule.suggestion || '';
    document.getElementById('ruleIsActive').checked = rule.is_active !== false;
    document.getElementById('ruleModal').style.display = 'flex';
}

function closeRuleModal() {
    document.getElementById('ruleModal').style.display = 'none';
}

async function saveRule() {
    const id = document.getElementById('ruleId').value;
    const ruleRef = document.getElementById('ruleRef').value.trim();
    const name = document.getElementById('ruleName').value.trim();
    if (!ruleRef || !name) { showToast('Rule Reference and Name are required.', 'error'); return; }

    const payload = {
        rule_reference: ruleRef,
        name,
        description: document.getElementById('ruleDesc').value.trim(),
        category: document.getElementById('ruleCategory').value,
        severity: document.getElementById('ruleSeverity').value,
        score_deduction: parseInt(document.getElementById('ruleScoreDeduction').value) || 10,
        penalty_section: document.getElementById('rulePenaltySection').value.trim(),
        statutory_act: document.getElementById('ruleStatutoryAct').value.trim(),
        suggestion: document.getElementById('ruleSuggestion').value.trim(),
        is_active: document.getElementById('ruleIsActive').checked,
        updated_at: new Date().toISOString()
    };

    let client;
    try { client = db(); } catch (e) { showToast('Supabase not ready.', 'error'); return; }

    try {
        if (id) {
            const { error } = await client.from('compliance_rules').update(payload).eq('id', id);
            if (error) throw error;
            const idx = allRules.findIndex(r => String(r.id) === String(id));
            if (idx !== -1) allRules[idx] = { ...allRules[idx], ...payload };
            showToast('Rule updated successfully.', 'success');
        } else {
            payload.created_at = new Date().toISOString();
            const { data, error } = await client.from('compliance_rules').insert(payload).select().single();
            if (error) throw error;
            allRules.push(data);
            showToast('Rule created successfully.', 'success');
        }
        closeRuleModal();
        renderRulesTab('mandatory_declaration');
        renderRulesTab('format_rule');
    } catch (err) {
        showToast('Error saving rule: ' + (err.message || err), 'error');
    }
}

// ── Delete Rule ──────────────────────────────────────────────
function openDeleteModal(id, label) {
    deleteTargetId = id;
    document.getElementById('deleteRulePreview').textContent = label;
    document.getElementById('deleteModal').style.display = 'flex';
}

function closeDeleteModal() {
    deleteTargetId = null;
    document.getElementById('deleteModal').style.display = 'none';
}

async function confirmDeleteRule() {
    if (!deleteTargetId) return;
    let client;
    try { client = db(); } catch (e) { showToast('Supabase not ready.', 'error'); return; }
    try {
        const { error } = await client.from('compliance_rules').delete().eq('id', deleteTargetId);
        if (error) throw error;
        allRules = allRules.filter(r => String(r.id) !== String(deleteTargetId));
        closeDeleteModal();
        renderRulesTab('mandatory_declaration');
        renderRulesTab('format_rule');
        showToast('Rule deleted successfully.', 'success');
    } catch (err) {
        showToast('Error deleting rule: ' + (err.message || err), 'error');
    }
}

// ── Prohibited Words ─────────────────────────────────────────
let prohibitedWordsData = null;

async function loadProhibitedWords() {
    let words = [...(CONFIG.PROHIBITED_QUANTITY_WORDS || [])];
    let client;
    try { client = db(); } catch (_) { prohibitedWordsData = words; renderProhibitedWords(); return; }
    try {
        const { data, error } = await client
            .from('compliance_settings')
            .select('value')
            .eq('key', 'prohibited_quantity_words')
            .single();
        if (!error && data) words = data.value;
    } catch (_) { /* use defaults */ }
    prohibitedWordsData = words;
    renderProhibitedWords();
}

function renderProhibitedWords() {
    const container = document.getElementById('prohibitedWordsTags');
    if (!container) return;
    if (!prohibitedWordsData || prohibitedWordsData.length === 0) {
        container.innerHTML = '<div style="color:var(--text-secondary); font-size:0.88rem;">No prohibited words defined yet.</div>';
        return;
    }
    container.innerHTML = prohibitedWordsData.map((w, i) =>
        '<span class="prohibited-tag">' + escHtml(w) +
        '<button onclick="removeProhibitedWord(' + i + ')" title="Remove">&times;</button></span>'
    ).join('');
}

function addProhibitedWord() {
    const input = document.getElementById('newProhibitedWordInput');
    const word = (input.value || '').trim().toLowerCase();
    if (!word) return;
    if (prohibitedWordsData.includes(word)) { showToast('Word already in the list.', 'error'); return; }
    prohibitedWordsData.push(word);
    input.value = '';
    renderProhibitedWords();
}

function removeProhibitedWord(index) {
    prohibitedWordsData.splice(index, 1);
    renderProhibitedWords();
}

async function saveProhibitedWords() {
    let client;
    try { client = db(); } catch (e) { showToast('Supabase not ready.', 'error'); return; }
    try {
        const { error } = await client.from('compliance_settings')
            .upsert({ key: 'prohibited_quantity_words', value: prohibitedWordsData, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (error) throw error;
        showToast('Prohibited words saved to database.', 'success');
    } catch (err) {
        showToast('Error saving: ' + (err.message || err), 'error');
    }
}

// ── Pack Sizes ───────────────────────────────────────────────
let packSizesData = null;

async function loadPackSizes() {
    let sizes = { ...(CONFIG.SECOND_SCHEDULE_PACK_SIZES || {}) };
    let client;
    try { client = db(); } catch (_) { packSizesData = sizes; renderPackSizes(); return; }
    try {
        const { data, error } = await client
            .from('compliance_settings')
            .select('value')
            .eq('key', 'second_schedule_pack_sizes')
            .single();
        if (!error && data) sizes = data.value;
    } catch (_) { /* use defaults */ }
    packSizesData = sizes;
    renderPackSizes();
}

function renderPackSizes() {
    const container = document.getElementById('packSizesList');
    if (!container || !packSizesData) return;
    const categories = Object.keys(packSizesData);
    if (categories.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="emoji">📦</div><h4>No categories defined.</h4></div>';
        return;
    }
    container.innerHTML = categories.map(cat => {
        const sizes = (packSizesData[cat] || []).map((v, i) =>
            '<span class="pack-size-tag">' + v + 'g/ml' +
            '<button onclick="removePackSize(\'' + escHtml(cat) + '\',' + i + ')">&times;</button></span>'
        ).join('');
        return '<div class="pack-category-card">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">' +
            '<strong style="font-size:0.95rem;color:var(--primary-navy);">' + escHtml(cat) + '</strong>' +
            '<button class="btn btn-sm" style="background:#FEF2F2;color:#B91C1C;border:1px solid #FCA5A5;font-size:0.78rem;" onclick="removePackCategory(\'' + escHtml(cat) + '\')">Remove Category</button>' +
            '</div>' +
            '<div class="pack-sizes-input">' + sizes + '</div>' +
            '<div style="display:flex;gap:8px;margin-top:10px;">' +
            '<input type="number" class="form-control" id="newSize-' + toCssId(cat) + '" placeholder="Add size (g/ml)" style="max-width:150px;" min="1">' +
            '<button class="btn btn-sm btn-outline-primary" onclick="addPackSize(\'' + escHtml(cat) + '\')">+ Add</button>' +
            '</div></div>';
    }).join('');
}

function addPackCategory() {
    const input = document.getElementById('newCategoryInput');
    const cat = (input.value || '').trim();
    if (!cat) return;
    if (packSizesData[cat] !== undefined) { showToast('Category already exists.', 'error'); return; }
    packSizesData[cat] = [];
    input.value = '';
    renderPackSizes();
}

function removePackCategory(cat) {
    if (!confirm('Remove category "' + cat + '" and all its pack sizes?')) return;
    delete packSizesData[cat];
    renderPackSizes();
}

function addPackSize(cat) {
    const input = document.getElementById('newSize-' + toCssId(cat));
    const val = parseInt(input?.value);
    if (!val || val <= 0) { showToast('Enter a valid positive number.', 'error'); return; }
    if ((packSizesData[cat] || []).includes(val)) { showToast('Size already listed.', 'error'); return; }
    packSizesData[cat] = [...(packSizesData[cat] || []), val].sort((a, b) => a - b);
    if (input) input.value = '';
    renderPackSizes();
}

function removePackSize(cat, index) {
    if (packSizesData[cat]) { packSizesData[cat].splice(index, 1); renderPackSizes(); }
}

async function savePackSizes() {
    let client;
    try { client = db(); } catch (e) { showToast('Supabase not ready.', 'error'); return; }
    try {
        const { error } = await client.from('compliance_settings')
            .upsert({ key: 'second_schedule_pack_sizes', value: packSizesData, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (error) throw error;
        showToast('Pack sizes saved to database.', 'success');
    } catch (err) {
        showToast('Error saving: ' + (err.message || err), 'error');
    }
}

// ── Utilities ────────────────────────────────────────────────
function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toCssId(str) {
    return String(str).replace(/[^a-zA-Z0-9]/g, '_');
}

function showToast(msg, type) {
    type = type || 'success';
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, 3500);
}
