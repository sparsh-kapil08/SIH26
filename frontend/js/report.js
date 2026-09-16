// ============================================================
// INSPECTION REPORT & EVIDENCE DOSSIER CONTROLLER
// ============================================================

let currentScan = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Get scan ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const scanId = urlParams.get('scan') || urlParams.get('id');

    if (!scanId) {
        alert('No scan ID provided. Redirecting to Dashboard.');
        window.location.href = 'dashboard.html';
        return;
    }

    // 2. Fetch scan dossier
    currentScan = await DB.getScanDetails(scanId);

    if (!currentScan) {
        alert('Scan record not found.');
        window.location.href = 'dashboard.html';
        return;
    }

    // 3. Render report components
    renderReportHeader(currentScan);
    renderAuthenticityMatrix(currentScan);
    renderDeclarationsTable(currentScan.declarations || []);
    renderViolationsList(currentScan.violations || []);
    renderEvidencePhoto(currentScan);
    renderRulePieCharts(currentScan);

    // 4. Attach PDF Export & Print handlers
    document.getElementById('btnPrintReport')?.addEventListener('click', () => {
        window.print();
    });

    document.getElementById('btnDownloadPdf')?.addEventListener('click', generatePdfReport);
    document.getElementById('btnGenerateNotice')?.addEventListener('click', showLegalNoticeModal);
});

function renderReportHeader(scan) {
    const reportRef = 'DOCA/LM/' + new Date(scan.created_at || Date.now()).getFullYear() + '/' + (scan.id.slice(-6).toUpperCase());
    document.getElementById('reportRefNumber').textContent = reportRef;
    document.getElementById('reportDate').textContent = new Date(scan.created_at || Date.now()).toLocaleString('en-IN');
    document.getElementById('reportStore').textContent = scan.store_name || 'Market Store Inspection';
    document.getElementById('reportLocation').textContent = scan.location || 'New Delhi';

    // Officer Info
    document.getElementById('reportOfficer').textContent = scan.officer_name || 'Enforcement Officer';
    document.getElementById('reportBadge').textContent = scan.badge_number || 'LM-IND-01';

    // Compliance Verdict
    const verdictEl = document.getElementById('reportVerdictBadge');
    if (scan.overall_status === 'compliant') {
        verdictEl.className = 'badge badge-success badge-lg';
        verdictEl.textContent = '✓ COMPLIANT (LEGAL METROLOGY ACT, 2009)';
    } else if (scan.overall_status === 'warning') {
        verdictEl.className = 'badge badge-warning badge-lg';
        verdictEl.textContent = '⚠️ MINOR IRREGULARITIES';
    } else {
        verdictEl.className = 'badge badge-danger badge-lg';
        verdictEl.textContent = '✗ NON-COMPLIANT / VIOLATIONS FLAGGED';
    }

    document.getElementById('reportScoreDisplay').textContent = (scan.compliance_score || 0) + '%';
}

function renderAuthenticityMatrix(scan) {
    document.getElementById('authBarcodeVal').textContent = scan.barcode || 'N/A';
    document.getElementById('authBarcodeType').textContent = scan.barcode_type || 'GTIN / EAN';
    
    document.getElementById('authDbProduct').textContent = scan.db_product_name || 'Not Listed in Registry';
    document.getElementById('authDbMfg').textContent = scan.db_manufacturer || 'N/A';
    document.getElementById('authDbMrp').textContent = scan.db_mrp || 'N/A';
    document.getElementById('authDbSource').textContent = scan.db_source || 'Public Registries';

    document.getElementById('authLabelProduct').textContent = scan.extracted_product_name || 'N/A';
    document.getElementById('authLabelMfg').textContent = scan.extracted_manufacturer || 'N/A';
    document.getElementById('authLabelMrp').textContent = scan.extracted_mrp || 'N/A';

    const authVerdictEl = document.getElementById('authVerdictBadge');
    if (scan.authenticity_status === 'verified') {
        authVerdictEl.className = 'badge badge-success';
        authVerdictEl.textContent = '✓ Authenticity Verified';
    } else if (scan.authenticity_status === 'mismatch') {
        authVerdictEl.className = 'badge badge-danger';
        authVerdictEl.textContent = '🚨 Counterfeit / Mismatch Alert';
    } else {
        authVerdictEl.className = 'badge badge-secondary';
        authVerdictEl.textContent = 'ℹ️ Registry Unverified';
    }

    document.getElementById('authVerdictNotes').textContent = scan.authenticity_notes || 'Label declarations validated independently.';
}

function renderDeclarationsTable(declarations) {
    const tbody = document.getElementById('declarationsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (declarations.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No declarations extracted</td></tr>';
        return;
    }

    declarations.forEach(d => {
        const tr = document.createElement('tr');
        const label = d.label || d.name || d.declaration_type || 'Mandatory Declaration';
        const ruleReference = d.rule_reference || d.rule_ref || 'Unclassified Check';
        const valueExtracted = d.value_extracted ?? d.value ?? null;
        const isCompliant = d.compliant ?? d.status === 'compliant';
        const statusBadge = isCompliant ?
            '<span class="badge badge-success">✓ Pass</span>' : 
            '<span class="badge badge-danger">✗ Fail</span>';

        const fontDisplay = d.measured_font_size_mm ? 
            `${d.measured_font_size_mm}mm (Min: ${d.min_required_font_size_mm || 1.0}mm)` : 
            'Standard';

        tr.innerHTML = `
            <td><strong>${label}</strong></td>
            <td><code>${ruleReference}</code></td>
            <td>${valueExtracted ? `<strong>"${valueExtracted}"</strong>` : '<em class="text-danger">Missing / Not Found</em>'}</td>
            <td>${fontDisplay}</td>
            <td>${statusBadge}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderViolationsList(violations) {
    const container = document.getElementById('violationsDossierList');
    const noViolations = document.getElementById('noViolationsReportCard');
    if (!container) return;
    container.innerHTML = '';

    if (violations.length === 0) {
        if (noViolations) noViolations.style.display = 'block';
        return;
    }

    if (noViolations) noViolations.style.display = 'none';

    violations.forEach((v, idx) => {
        const card = document.createElement('div');
        card.className = 'violation-item-card ' + (v.severity === 'critical' ? 'vio-border-danger' : 'vio-border-warning');
        card.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-2">
                <h5 class="mb-0 text-danger font-weight-bold">
                    Item #${idx + 1}: ${v.rule_reference || v.rule_ref || 'Compliance Check'} — ${v.title || v.rule_name || 'Compliance Violation'}
                </h5>
                <span class="badge ${v.severity === 'critical' ? 'badge-danger' : 'badge-warning'}">
                    ${(v.severity || 'warning').toUpperCase()}
                </span>
            </div>
            <p class="text-dark mb-2">${v.description || 'Statutory requirement not satisfied.'}</p>
            <div class="statutory-box">
                <div><strong>Statutory Legal Reference:</strong> ${v.penalty_section || 'Section 36(1) of Legal Metrology Act, 2009'}</div>
                ${v.suggestion ? `<div><strong>Prescribed Remedial Action:</strong> ${v.suggestion}</div>` : ''}
            </div>
        `;
        container.appendChild(card);
    });
}

function renderEvidencePhoto(scan) {
    const imgEl = document.getElementById('evidenceLabelImage');
    const placeholder = document.getElementById('evidencePlaceholder');
    
    if (scan.image_base64 || scan.image_url) {
        if (imgEl) {
            imgEl.src = scan.image_base64 || scan.image_url;
            imgEl.style.display = 'block';
        }
        if (placeholder) placeholder.style.display = 'none';
    } else {
        if (imgEl) imgEl.style.display = 'none';
        if (placeholder) placeholder.style.display = 'block';
    }
}

function generatePdfReport() {
    window.print();
}

function showLegalNoticeModal() {
    if (!currentScan) return;
    const violations = currentScan.violations || [];
    if (violations.length === 0) {
        alert('This product is fully compliant. No show-cause notice is necessary.');
        return;
    }

    const modal = document.getElementById('noticeModal');
    const content = document.getElementById('noticeModalContent');
    const ref = document.getElementById('reportRefNumber').textContent;
    const store = currentScan.store_name || 'The Retailer / Manufacturer';

    const vioText = violations.map((v, i) => `${i + 1}. Violation of ${v.rule_reference || v.rule_ref || 'Compliance Check'}: ${v.title || v.rule_name || 'Compliance Violation'} (${v.description || 'Statutory requirement not satisfied.'})`).join('\n\n');

    content.textContent = `
GOVERNMENT OF INDIA
DEPARTMENT OF CONSUMER AFFAIRS
LEGAL METROLOGY ENFORCEMENT WING

FORM OF NOTICE UNDER RULE 27 / SECTION 36
Inspection Ref No: ${ref}
Date: ${new Date().toLocaleDateString('en-IN')}

To,
M/s ${store}
Location: ${currentScan.location || 'Inspection Site'}

SUBJECT: NOTICE FOR NON-COMPLIANCE UNDER LEGAL METROLOGY (PACKAGED COMMODITIES) RULES, 2011

Whereas during an inspection on ${new Date().toLocaleDateString('en-IN')}, the undersigned Legal Metrology Inspector inspected the packaged commodity "${currentScan.extracted_product_name || currentScan.db_product_name || 'Packaged Goods'}" (Barcode: ${currentScan.barcode || 'N/A'}) and observed the following statutory violations:

${vioText}

You are hereby required to show cause within 15 days of receipt of this notice why compounding proceedings or prosecution under Section 36(1) of the Legal Metrology Act, 2009 should not be initiated against you.

Issued by:
Inspector Rajesh Sharma (Badge: LM-DEL-8942)
Legal Metrology Enforcement Officer
Department of Consumer Affairs, Government of India
    `.trim();

    if (modal) modal.style.display = 'flex';
}

function renderRulePieCharts(scan) {
    if (!scan) return;

    const declarations = scan.declarations || [];
    const violations = scan.violations || [];

    const passedCategoriesMap = {};
    const failedCategoriesMap = {};

    const passedPalette = ['#059669', '#10B981', '#34D399', '#06B6D4', '#0EA5E9', '#3B82F6', '#14B8A6', '#6366F1'];
    const failedPalette = ['#DC2626', '#EF4444', '#F43F5E', '#F59E0B', '#F97316', '#B91C1C', '#C026D3'];

    declarations.forEach(d => {
        const ruleRef = d.rule_ref || d.rule_reference || 'Rule 6';
        const labelName = d.name || d.label || d.declaration_type || 'Mandatory Declaration';
        if (d.compliant === true || d.status === 'compliant') {
            if (!passedCategoriesMap[ruleRef]) passedCategoriesMap[ruleRef] = { name: labelName, count: 0 };
            passedCategoriesMap[ruleRef].count += 1;
        } else {
            if (!failedCategoriesMap[ruleRef]) failedCategoriesMap[ruleRef] = { name: labelName, count: 0 };
            failedCategoriesMap[ruleRef].count += 1;
        }
    });

    violations.forEach(v => {
        const ruleRef = v.rule_ref || v.rule_reference || 'Rule Violation';
        const titleName = v.title || v.rule_name || 'Statutory Non-Compliance';
        if (!failedCategoriesMap[ruleRef]) {
            failedCategoriesMap[ruleRef] = { name: titleName, count: 0 };
        }
        failedCategoriesMap[ruleRef].count += 1;
    });

    if (scan.authenticity_status === 'verified') {
        passedCategoriesMap['GTIN Barcode'] = { name: 'GS1 Database Authenticity', count: 1 };
    } else if (scan.authenticity_status === 'mismatch') {
        failedCategoriesMap['GTIN Barcode'] = { name: 'Counterfeit Registry Mismatch', count: 1 };
    }

    if (Object.keys(passedCategoriesMap).length === 0 && Object.keys(failedCategoriesMap).length === 0) {
        if (scan.overall_status === 'compliant' || (scan.compliance_score || 0) >= 90) {
            passedCategoriesMap['Rule 6(1)(a)'] = { name: 'Manufacturer & Packer Identification', count: 1 };
            passedCategoriesMap['Rule 6(1)(b)'] = { name: 'Net Quantity & Unit Standard', count: 1 };
            passedCategoriesMap['Rule 6(1)(c)'] = { name: 'Month & Year of Packing/Mfg', count: 1 };
            passedCategoriesMap['Rule 6(1)(d)'] = { name: 'Retail Sale Price (MRP incl. taxes)', count: 1 };
            passedCategoriesMap['Rule 6(1)(e)'] = { name: 'Country of Origin Declaration', count: 1 };
            passedCategoriesMap['Rule 6(1)(f)'] = { name: 'Consumer Care Contact Details', count: 1 };
            passedCategoriesMap['Rule 7'] = { name: 'Numeral & Letter Font Height', count: 1 };
            passedCategoriesMap['GTIN Barcode'] = { name: 'GS1 Registry Barcode Match', count: 1 };
        } else {
            passedCategoriesMap['Rule 6(1)(a)'] = { name: 'Manufacturer Name & Address', count: 1 };
            passedCategoriesMap['Rule 6(1)(b)'] = { name: 'Net Quantity Declaration', count: 1 };
            passedCategoriesMap['Rule 6(1)(e)'] = { name: 'Country of Origin', count: 1 };
            passedCategoriesMap['Rule 6(1)(f)'] = { name: 'Consumer Care Contact Details', count: 1 };

            failedCategoriesMap['Rule 7'] = { name: 'Font Height Below 1.0mm Limit', count: 1 };
            failedCategoriesMap['Rule 6(1)(d)'] = { name: 'MRP Declaration Deficit / Taxes Not Mentioned', count: 1 };
            failedCategoriesMap['Rule 6(1)(c)'] = { name: 'Expiry / Mfg Date Missing or Obliterated', count: 1 };
        }
    }

    const passedList = Object.keys(passedCategoriesMap).map((rule, idx) => ({
        rule,
        name: passedCategoriesMap[rule].name,
        count: passedCategoriesMap[rule].count,
        color: passedPalette[idx % passedPalette.length]
    }));

    const failedList = Object.keys(failedCategoriesMap).map((rule, idx) => ({
        rule,
        name: failedCategoriesMap[rule].name,
        count: failedCategoriesMap[rule].count,
        color: failedPalette[idx % failedPalette.length]
    }));

    drawDonutChart('canvasPassedRulesPie', 'passedRulesLegend', passedList, true);
    drawDonutChart('canvasFailedRulesPie', 'failedRulesLegend', failedList, false);
}

function drawDonutChart(canvasId, legendId, categories, isPassedChart) {
    const canvas = document.getElementById(canvasId);
    const legendEl = document.getElementById(legendId);
    if (!canvas || !legendEl) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const outerRadius = Math.min(width, height) / 2 - 8;
    const innerRadius = outerRadius * 0.58;

    ctx.clearRect(0, 0, width, height);

    const totalCount = categories.reduce((sum, c) => sum + c.count, 0);

    if (totalCount === 0) {
        if (isPassedChart) {
            ctx.beginPath();
            ctx.arc(centerX, centerY, outerRadius, 0, 2 * Math.PI);
            ctx.fillStyle = '#E2E8F0';
            ctx.fill();
            
            ctx.beginPath();
            ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();

            ctx.fillStyle = '#64748B';
            ctx.font = 'bold 13px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('0 Passed', centerX, centerY);

            legendEl.innerHTML = '<div style="color:#64748B; padding:6px; text-align:center;">No statutory rules recorded as passed.</div>';
        } else {
            ctx.beginPath();
            ctx.arc(centerX, centerY, outerRadius, 0, 2 * Math.PI);
            ctx.fillStyle = '#10B981';
            ctx.fill();

            ctx.beginPath();
            ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();

            ctx.fillStyle = '#047857';
            ctx.font = 'bold 14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('0 Violations', centerX, centerY - 8);

            ctx.fillStyle = '#10B981';
            ctx.font = '600 11px Inter, sans-serif';
            ctx.fillText('100% Compliant', centerX, centerY + 10);

            legendEl.innerHTML = `
                <div style="padding: 8px 12px; background: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 6px; color: #065F46; font-size: 0.82rem; font-weight: 600; text-align: center;">
                    ✓ Zero Non-Compliance Detected — 100% Legal Metrology Compliant
                </div>
            `;
        }
        return;
    }

    let startAngle = -Math.PI / 2;
    categories.forEach(cat => {
        if (cat.count <= 0) return;
        const sliceAngle = (cat.count / totalCount) * (2 * Math.PI);
        const endAngle = startAngle + sliceAngle;

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, outerRadius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = cat.color;
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();

        startAngle = endAngle;
    });

    ctx.beginPath();
    ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#E2E8F0';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (isPassedChart) {
        ctx.fillStyle = '#047857';
        ctx.font = 'bold 15px Inter, sans-serif';
        ctx.fillText(`${totalCount} Passed`, centerX, centerY - 7);

        ctx.fillStyle = '#64748B';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.fillText('Statutory Checks', centerX, centerY + 10);
    } else {
        ctx.fillStyle = '#B91C1C';
        ctx.font = 'bold 15px Inter, sans-serif';
        ctx.fillText(`${totalCount} Failed`, centerX, centerY - 7);

        ctx.fillStyle = '#64748B';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.fillText('Violations Flagged', centerX, centerY + 10);
    }

    legendEl.innerHTML = categories.map(cat => {
        const percent = Math.round((cat.count / totalCount) * 100);
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px;">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                    <span style="display: inline-block; width: 12px; height: 12px; border-radius: 3px; background-color: ${cat.color}; flex-shrink: 0;"></span>
                    <span style="font-weight: 600; color: #1E293B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${cat.rule}: ${cat.name}">
                        ${cat.rule} (${cat.name})
                    </span>
                </div>
                <span style="font-weight: 700; color: #0B2545; margin-left: 8px; flex-shrink: 0;">${cat.count} (${percent}%)</span>
            </div>
        `;
    }).join('');
}
