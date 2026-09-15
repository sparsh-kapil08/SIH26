// ============================================================
// DASHBOARD CONTROLLER (Analytics, Scans Table & Access Control)
// ============================================================

let currentUser = null;
let allScans = [];
let filteredScans = [];

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Get current logged in user
    currentUser = await DB.getCurrentUser();
    renderUserProfile(currentUser);

    // 2. Load scans dataset
    await loadScansData();

    // 3. Attach search and filter event listeners
    setupFilters();

    // 4. Logout handler
    document.getElementById('btnLogout')?.addEventListener('click', () => {
        localStorage.removeItem('doca_auth_user');
        window.location.href = 'login.html';
    });

    // 5. Export CSV handler
    document.getElementById('btnExportCsv')?.addEventListener('click', exportScansCsv);
});

function renderUserProfile(user) {
    const nameEl = document.getElementById('userNameDisplay');
    const badgeEl = document.getElementById('userBadgeDisplay');
    const roleEl = document.getElementById('userRoleBadge');
    const adminBanner = document.getElementById('adminControlsBanner');

    if (nameEl) nameEl.textContent = user.name;
    if (badgeEl) badgeEl.textContent = user.badge_number || 'LM-IND-01';
    
    if (roleEl) {
        if (user.role === 'admin') {
            roleEl.className = 'badge badge-admin';
            roleEl.textContent = '👑 Supervisor / Admin';
            if (adminBanner) adminBanner.style.display = 'flex';
        } else {
            roleEl.className = 'badge badge-officer';
            roleEl.textContent = '🛡️ Enforcement Officer';
            if (adminBanner) adminBanner.style.display = 'none';
        }
    }
}

async function loadScansData() {
    allScans = await DB.getScansList(currentUser?.role || 'officer', currentUser?.id);
    filteredScans = [...allScans];

    updateKpiStats(allScans);
    renderScansTable(filteredScans);
}

function updateKpiStats(scans) {
    const total = scans.length;
    const compliant = scans.filter(s => s.overall_status === 'compliant').length;
    const nonCompliant = scans.filter(s => s.overall_status === 'non_compliant').length;
    const authFlags = scans.filter(s => s.authenticity_status === 'mismatch').length;
    
    let totalScore = 0;
    scans.forEach(s => totalScore += (s.compliance_score || 0));
    const avgScore = total > 0 ? Math.round(totalScore / total) : 0;

    const elTotal = document.getElementById('statTotalScans');
    const elCompliant = document.getElementById('statCompliant');
    const elNonCompliant = document.getElementById('statNonCompliant');
    const elAuthFlags = document.getElementById('statAuthFlags');
    const elAvgScore = document.getElementById('statAvgScore');

    if (elTotal) elTotal.textContent = total;
    if (elCompliant) elCompliant.textContent = compliant;
    if (elNonCompliant) elNonCompliant.textContent = nonCompliant;
    if (elAuthFlags) elAuthFlags.textContent = authFlags;
    if (elAvgScore) elAvgScore.textContent = avgScore + '%';
}

function setupFilters() {
    const searchInput = document.getElementById('searchScans');
    const filterStatus = document.getElementById('filterStatus');

    function applyFilters() {
        const query = (searchInput?.value || '').toLowerCase().trim();
        const status = filterStatus?.value || 'all';

        filteredScans = allScans.filter(s => {
            const matchesQuery = !query || 
                (s.extracted_product_name && s.extracted_product_name.toLowerCase().includes(query)) ||
                (s.db_product_name && s.db_product_name.toLowerCase().includes(query)) ||
                (s.barcode && s.barcode.includes(query)) ||
                (s.store_name && s.store_name.toLowerCase().includes(query)) ||
                (s.location && s.location.toLowerCase().includes(query));

            const matchesStatus = (status === 'all') ||
                (status === 'compliant' && s.overall_status === 'compliant') ||
                (status === 'non_compliant' && s.overall_status === 'non_compliant') ||
                (status === 'mismatch' && s.authenticity_status === 'mismatch') ||
                (status === 'warning' && s.overall_status === 'warning');

            return matchesQuery && matchesStatus;
        });

        renderScansTable(filteredScans);
    }

    searchInput?.addEventListener('input', applyFilters);
    filterStatus?.addEventListener('change', applyFilters);
}

function renderScansTable(scans) {
    const tbody = document.getElementById('scansTableBody');
    const emptyState = document.getElementById('scansEmptyState');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (scans.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    scans.forEach(s => {
        const tr = document.createElement('tr');
        
        // Status Badge
        let statusBadge = '<span class="badge badge-success">Compliant</span>';
        if (s.overall_status === 'non_compliant') {
            statusBadge = '<span class="badge badge-danger">Non-Compliant</span>';
        } else if (s.overall_status === 'warning') {
            statusBadge = '<span class="badge badge-warning">Review</span>';
        }

        // Authenticity Badge
        let authBadge = '<span class="badge badge-secondary">N/A</span>';
        if (s.authenticity_status === 'verified') {
            authBadge = '<span class="badge badge-success">✓ Verified</span>';
        } else if (s.authenticity_status === 'mismatch') {
            authBadge = '<span class="badge badge-danger">🚨 Counterfeit Risk</span>';
        }

        const dateStr = s.created_at ? new Date(s.created_at).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : 'Recent';

        const prodName = s.extracted_product_name || s.db_product_name || 'Packaged Commodity';
        const mfg = s.extracted_manufacturer || s.db_manufacturer || 'Manufacturer Not Listed';
        const barcodeDisplay = s.barcode ? `<code>${s.barcode}</code>` : '<span class="text-muted">No Barcode</span>';

        tr.innerHTML = `
            <td>
                <strong>${prodName}</strong>
                <div class="text-muted small">${mfg}</div>
            </td>
            <td>${barcodeDisplay}</td>
            <td>${statusBadge}</td>
            <td>${authBadge}</td>
            <td>
                <span class="score-pill ${s.compliance_score >= 80 ? 'score-green' : s.compliance_score >= 60 ? 'score-amber' : 'score-red'}">
                    ${s.compliance_score || 0}%
                </span>
            </td>
            <td>
                <div>${s.store_name || 'Market Store'}</div>
                <div class="text-muted small">${s.location || 'New Delhi'}</div>
            </td>
            <td><small class="text-muted">${dateStr}</small></td>
            <td>
                <a href="report.html?scan=${s.id}" class="btn btn-sm btn-outline-primary dossier-link">
                    View Dossier 📄
                </a>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function exportScansCsv() {
    if (allScans.length === 0) {
        alert('No inspection records to export.');
        return;
    }

    const headers = ['Scan ID', 'Barcode', 'Product Name', 'Manufacturer', 'Overall Status', 'Compliance Score', 'Authenticity', 'Violations Count', 'Store Name', 'Location', 'Date'];
    const rows = allScans.map(s => [
        `"${s.id}"`,
        `"${s.barcode || ''}"`,
        `"${(s.extracted_product_name || s.db_product_name || '').replace(/"/g, '""')}"`,
        `"${(s.extracted_manufacturer || s.db_manufacturer || '').replace(/"/g, '""')}"`,
        `"${s.overall_status}"`,
        s.compliance_score || 0,
        `"${s.authenticity_status}"`,
        s.violation_count || 0,
        `"${(s.store_name || '').replace(/"/g, '""')}"`,
        `"${(s.location || '').replace(/"/g, '""')}"`,
        `"${s.created_at || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `legal_metrology_scans_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
