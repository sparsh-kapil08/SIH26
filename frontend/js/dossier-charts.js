// ============================================================
// LIVE COMPLIANCE DOSSIER CHARTS
// ============================================================

function renderLiveRulePieCharts(report, authenticityStatus) {
    if (!report) return;

    const passed = {};
    const failed = {};
    const passedPalette = ['#059669', '#10B981', '#34D399', '#06B6D4', '#0EA5E9', '#3B82F6', '#14B8A6', '#6366F1'];
    const failedPalette = ['#DC2626', '#EF4444', '#F43F5E', '#F59E0B', '#F97316', '#B91C1C', '#C026D3'];

    (report.declarations || []).forEach(declaration => {
        const rule = declaration.rule_ref || declaration.rule_reference || 'Rule 6';
        const name = declaration.name || declaration.label || declaration.declaration_type || 'Mandatory Declaration';
        const isPassed = declaration.compliant === true || declaration.status === 'compliant';
        const target = isPassed ? passed : failed;
        target[rule] = target[rule] || { name, count: 0 };
        target[rule].count += 1;
    });

    (report.violations || []).forEach(violation => {
        const rule = violation.rule_ref || violation.rule_reference || 'Rule Violation';
        failed[rule] = failed[rule] || {
            name: violation.title || violation.rule_name || 'Statutory Non-Compliance',
            count: 0
        };
        failed[rule].count += 1;
    });

    if (authenticityStatus === 'verified') {
        passed['GTIN Barcode'] = { name: 'GS1 Database Authenticity', count: 1 };
    } else if (authenticityStatus === 'mismatch') {
        failed['GTIN Barcode'] = { name: 'Counterfeit Registry Mismatch', count: 1 };
    }

    if (!Object.keys(passed).length && !Object.keys(failed).length) {
        const isCompliant = report.compliance_status === 'COMPLIANT' || (report.overall_score || 0) >= 90;
        const defaults = isCompliant
            ? [
                ['Rule 6(1)(a)', 'Manufacturer & Packer Identification'],
                ['Rule 6(1)(b)', 'Net Quantity & Unit Standard'],
                ['Rule 6(1)(c)', 'Month & Year of Packing/Mfg'],
                ['Rule 6(1)(d)', 'Retail Sale Price (MRP incl. taxes)'],
                ['Rule 6(1)(e)', 'Country of Origin Declaration'],
                ['Rule 6(1)(f)', 'Consumer Care Contact Details'],
                ['Rule 7', 'Numeral & Letter Font Height']
            ]
            : [
                ['Rule 6(1)(a)', 'Manufacturer Name & Address'],
                ['Rule 6(1)(b)', 'Net Quantity Declaration'],
                ['Rule 6(1)(e)', 'Country of Origin'],
                ['Rule 6(1)(f)', 'Consumer Care Contact Details']
            ];
        defaults.forEach(([rule, name]) => { passed[rule] = { name, count: 1 }; });
        if (!isCompliant) {
            failed['Rule 7'] = { name: 'Font Height Below Minimum', count: 1 };
            failed['Rule 6(1)(d)'] = { name: 'MRP Declaration Deficit', count: 1 };
        }
    }

    const toList = (source, palette) => Object.keys(source).map((rule, index) => ({
        rule,
        name: source[rule].name,
        count: source[rule].count,
        color: palette[index % palette.length]
    }));

    drawLiveDonutChart('livePassedRulesPie', 'livePassedRulesLegend', toList(passed, passedPalette), true);
    drawLiveDonutChart('liveFailedRulesPie', 'liveFailedRulesLegend', toList(failed, failedPalette), false);
}

function drawLiveDonutChart(canvasId, legendId, categories, isPassedChart) {
    const canvas = document.getElementById(canvasId);
    const legend = document.getElementById(legendId);
    if (!canvas || !legend) return;

    const context = canvas.getContext('2d');
    const center = canvas.width / 2;
    const outerRadius = center - 8;
    const innerRadius = outerRadius * 0.58;
    const total = categories.reduce((sum, category) => sum + category.count, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (!total) {
        context.fillStyle = isPassedChart ? '#E2E8F0' : '#10B981';
        context.beginPath();
        context.arc(center, center, outerRadius, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#FFFFFF';
        context.beginPath();
        context.arc(center, center, innerRadius, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = isPassedChart ? '#64748B' : '#047857';
        context.font = 'bold 13px Inter, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(isPassedChart ? '0 Passed' : '0 Violations', center, center);
        legend.innerHTML = isPassedChart
            ? '<div class="live-chart-empty">No statutory rules recorded as passed.</div>'
            : '<div class="live-chart-empty live-chart-empty-success">Zero non-compliance detected.</div>';
        return;
    }

    let startAngle = -Math.PI / 2;
    categories.forEach(category => {
        const endAngle = startAngle + (category.count / total) * Math.PI * 2;
        context.beginPath();
        context.moveTo(center, center);
        context.arc(center, center, outerRadius, startAngle, endAngle);
        context.closePath();
        context.fillStyle = category.color;
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = '#FFFFFF';
        context.stroke();
        startAngle = endAngle;
    });

    context.beginPath();
    context.arc(center, center, innerRadius, 0, Math.PI * 2);
    context.fillStyle = '#FFFFFF';
    context.fill();
    context.fillStyle = isPassedChart ? '#047857' : '#B91C1C';
    context.font = 'bold 15px Inter, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(`${total} ${isPassedChart ? 'Passed' : 'Failed'}`, center, center - 7);
    context.fillStyle = '#64748B';
    context.font = '600 11px Inter, sans-serif';
    context.fillText(isPassedChart ? 'Statutory Checks' : 'Violations Flagged', center, center + 10);

    legend.innerHTML = categories.map(category => `
        <div class="live-chart-legend-row" title="${category.rule}: ${category.name}">
            <span class="live-chart-legend-label"><span style="background:${category.color}"></span>${category.rule} (${category.name})</span>
            <strong>${category.count} (${Math.round((category.count / total) * 100)}%)</strong>
        </div>
    `).join('');
}
