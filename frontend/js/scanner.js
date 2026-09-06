// ============================================================
// SCANNER CONTROLLER (Step-by-Step Inspection Wizard)
// Handles Camera, Multi-Source Barcode, Label Capture & AI Run
// ============================================================

let currentStep = 1;
let cameraStream = null;
let barcodeDetector = null;
let isDetectingBarcode = true;

const scanState = {
    barcodeData: null,
    labelImage: null,
    labelImages: [],
    calibration: {
        method: 'credit_card',
        cardWidthMm: 85.6,
        cardPixelWidth: 320,
        pxPerMm: 3.73
    },
    visionData: null,
    complianceReport: null
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const profile = (typeof SupabaseService !== 'undefined' && SupabaseService.getProfile)
            ? await SupabaseService.getProfile()
            : { name: 'Inspector Rajesh Sharma', badge_number: 'LM-DEL-8942', role: 'officer' };

        const nameEl = document.getElementById('officerNameDisplay') || document.getElementById('officerBadge');
        if (nameEl) nameEl.textContent = profile.full_name || profile.name || 'Enforcement Inspector';

        const badgeEl = document.getElementById('badgeDisplay');
        if (badgeEl) badgeEl.textContent = profile.badge_number || 'LM-DEL-8942';
    } catch(err) {
        console.warn('Auth profile initialization note:', err.message);
    }

    initWizardNav();
    initCamera();
    initStepHandlers();
});

function initWizardNav() {
    document.querySelectorAll('.step-indicator').forEach(stepEl => {
        stepEl.addEventListener('click', () => {
            const stepNum = parseInt(stepEl.id.replace('stepInd', ''), 10);
            if (canNavigateToStep(stepNum)) {
                goToStep(stepNum);
            }
        });
    });
}

function canNavigateToStep(step) {
    if (step <= currentStep) return true;
    if (step === 2 && scanState.barcodeData) return true;
    if (step === 3 && (scanState.barcodeData || currentStep >= 1)) return true;
    if (step === 4 && scanState.labelImage) return true;
    if (step === 5 && scanState.complianceReport) return true;
    return false;
}

function goToStep(step) {
    currentStep = step;
    document.querySelectorAll('.step-indicator').forEach(el => {
        const s = parseInt(el.getAttribute('data-step'), 10);
        const indicatorStep = Number.isNaN(s) ? parseInt(el.id.replace('stepInd', ''), 10) : s;
        el.classList.remove('active', 'completed');
        if (indicatorStep === step) el.classList.add('active');
        else if (indicatorStep < step) el.classList.add('completed');
    });

    document.querySelectorAll('.wizard-step-content').forEach(el => el.classList.remove('active'));
    const targetContent = document.getElementById(`stepContent${step}`);
    if (targetContent) targetContent.classList.add('active');

    const video = document.getElementById('cameraFeed');
    const container = document.getElementById('cameraFeedContainer');
    const preview = document.getElementById('capturedLabelPreview');

    if (step === 1) {
        isDetectingBarcode = true;
        if (container) container.style.display = 'block';
        if (preview) preview.style.display = 'none';
        if (video && cameraStream) {
            video.srcObject = cameraStream;
            video.play().catch(()=>{});
        }
        barcodeDetectionLoop();
    } else if (step === 3) {
        isDetectingBarcode = false;
        if (!scanState.labelImage) {
            const labelVideo = document.getElementById('labelCameraFeed');
            const labelPlaceholder = document.getElementById('labelCameraPlaceholder');
            const labelContainer = document.getElementById('cameraFeedContainer3');
            if (labelContainer) labelContainer.style.display = 'block';
            if (preview) preview.style.display = 'none';

            if (cameraStream) {
                if (labelVideo) {
                    labelVideo.srcObject = cameraStream;
                    labelVideo.play().catch(()=>{});
                    if (labelPlaceholder) labelPlaceholder.style.display = 'none';
                }
                if (video) {
                    video.srcObject = cameraStream;
                    video.play().catch(()=>{});
                }
            }
        }
    } else {
        isDetectingBarcode = false;
    }
}

async function initCamera() {
    const video = document.getElementById('cameraFeed');
    const status = document.getElementById('cameraStatus');
    const placeholder = document.getElementById('cameraPlaceholder');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (placeholder) placeholder.innerHTML = '<div style="font-size:1.8rem">⚠️</div><div>Camera API unavailable. Use file upload below.</div>';
        if (status) status.innerHTML = '<span class="badge badge-warning">⚠️ Camera not supported in this browser</span>';
        return;
    }

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        });

        if (video) {
            video.srcObject = cameraStream;

            await new Promise((resolve) => {
                video.onloadedmetadata = resolve;
            });

            try {
                await video.play();
            } catch (playErr) {
                video.muted = true;
                await video.play();
            }

            if (placeholder) placeholder.style.display = 'none';
            if (status) status.innerHTML = '<span class="badge badge-success">📷 Camera Live</span>';
            initBarcodeDetector();
        }
    } catch (err) {
        console.warn('Camera access error:', err.name, err.message);
        if (placeholder) {
            placeholder.innerHTML = `
                <div style="font-size:1.8rem">🚫</div>
                <div style="text-align:center;padding:0 20px;">
                    Camera permission denied.<br>
                    <span style="font-size:0.8rem;opacity:0.7;">Allow camera in browser settings, or use file upload below.</span>
                </div>`;
        }
        if (status) status.innerHTML = `<span class="badge badge-warning">⚠️ Camera denied — use file upload</span>`;
    }
}

function initBarcodeDetector() {
    if ('BarcodeDetector' in window) {
        barcodeDetector = new BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code']
        });
        barcodeDetectionLoop();
    }
}

async function barcodeDetectionLoop() {
    const video = document.getElementById('cameraFeed');
    if (video && video.readyState === video.HAVE_ENOUGH_DATA && barcodeDetector && isDetectingBarcode && !scanState.barcodeData) {
        try {
            const barcodes = await barcodeDetector.detect(video);
            if (barcodes.length > 0) {
                const detectedCode = barcodes[0].rawValue;
                isDetectingBarcode = false;
                highlightBarcodeTarget();
                processBarcode(detectedCode);
                return;
            }
        } catch(e){}
    }
    if (isDetectingBarcode && !scanState.barcodeData) {
        requestAnimationFrame(barcodeDetectionLoop);
    }
}

function highlightBarcodeTarget() {
    const reticle = document.getElementById('scanReticle');
    if (reticle) reticle.classList.add('detected');
}

async function processBarcode(code) {
    showLoading('Validating GS1 barcode across multiple registries...');
    const result = await BarcodeEngine.lookupProduct(code);
    scanState.barcodeData = result;
    hideLoading();

    renderBarcodeVerification(result);
    goToStep(2);
}

function renderBarcodeVerification(res) {
    const bcEl = document.getElementById('displayBarcode');
    const bcTypeEl = document.getElementById('displayBarcodeType');
    if (bcEl) bcEl.textContent = res.barcode || 'N/A';
    if (bcTypeEl) {
        bcTypeEl.textContent = res.gs1Allocation 
            ? `${res.gs1Allocation.country} (Prefix ${res.gs1Allocation.prefix})`
            : 'Standard EAN/GTIN';
    }

    const checkBadge = document.getElementById('badgeCheckDigit');
    if (checkBadge) {
        if (res.isValidCheckDigit) {
            checkBadge.className = 'badge badge-success';
            checkBadge.textContent = '✓ Check-Digit Valid (Modulo 10)';
        } else {
            checkBadge.className = 'badge badge-warning';
            checkBadge.textContent = '⚠️ Unchecked Check-Digit';
        }
    }

    const regBadge = document.getElementById('badgeRegistry');
    const dbCard = document.getElementById('dbInfoCard');
    const unregNote = document.getElementById('unregisteredNote');

    if (res.isRegistered) {
        if (regBadge) {
            regBadge.className = 'badge badge-success';
            regBadge.textContent = `✓ Verified (${res.sourcesConfirmed.join(', ')})`;
        }
        document.getElementById('dbProductName').textContent = res.productName || 'N/A';
        document.getElementById('dbManufacturer').textContent = res.manufacturer || res.brand || 'N/A';
        document.getElementById('dbMrp').textContent = res.mrp || 'N/A';
        document.getElementById('dbSource').textContent = res.sourcesConfirmed.join(' + ') || 'GS1 / Open Food Facts';
        if (dbCard) dbCard.style.display = 'block';
        if (unregNote) unregNote.style.display = 'none';
    } else if (res.verificationStatus === 'gs1_prefix_verified') {
        if (regBadge) {
            regBadge.className = 'badge badge-info';
            regBadge.style.background = '#0284C7';
            regBadge.style.color = '#FFFFFF';
            regBadge.textContent = `✓ GS1 Allocated Prefix (${res.gs1Allocation.country})`;
        }
        if (dbCard) dbCard.style.display = 'none';
        if (unregNote) {
            unregNote.style.display = 'block';
            unregNote.innerHTML = `<strong>GS1 Country Allocation Verified:</strong> Barcode prefix <code>${res.gs1Allocation.prefix}</code> is assigned to <strong>${res.gs1Allocation.country}</strong> with valid Modulo-10 checksum. Specific SKU is unindexed in open public crowdsourced DBs. Multimodal AI will perform full label authenticity audit in Step 4.`;
        }
    } else {
        if (regBadge) {
            regBadge.className = 'badge badge-warning';
            regBadge.textContent = '⚠️ Unindexed in Public Catalogs';
        }
        if (dbCard) dbCard.style.display = 'none';
        if (unregNote) {
            unregNote.style.display = 'block';
            unregNote.innerHTML = `<strong>Multi-Source Note:</strong> Checked multiple registries (${res.sourcesChecked.join(', ')}). Proceeding to label capture for AI-driven label authenticity evaluation.`;
        }
    }
}

function captureLabelPhoto() {
    if (scanState.labelImages.length >= 4) {
        alert('You can add up to 4 inspection photos.');
        return;
    }
    const video = document.getElementById('labelCameraFeed') || document.getElementById('cameraFeed');
    if (!video || (!video.videoWidth && !video.srcObject)) {
        console.warn('[Camera] No active camera stream to capture from');
        alert('Camera is not active. Please use the file upload option below.');
        return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    console.log('[Camera] Label photo captured. Size:', Math.round(dataUrl.length / 1024), 'KB');
    addLabelImage(dataUrl);
}

function handleFileUpload(e) {
    const files = Array.from(e.target.files || []);
    const availableSlots = 4 - scanState.labelImages.length;
    if (!files.length || availableSlots <= 0) return;
    files.slice(0, availableSlots).forEach(file => {
        console.log('[Upload] File selected:', file.name, file.type, Math.round(file.size / 1024), 'KB');
        const reader = new FileReader();
        reader.onload = event => addLabelImage(event.target.result);
        reader.readAsDataURL(file);
    });
    e.target.value = '';
}

function openPerspectiveCropper(dataUrl, callback) {
    const modal = document.getElementById('cropperModal');
    if (!modal || typeof PerspectiveCropper === 'undefined') {
        console.warn('[Cropper] Cropper modal or PerspectiveCropper module not available. Proceeding with uncropped image.');
        callback(dataUrl);
        return;
    }

    modal.style.display = 'flex';
    PerspectiveCropper.initEditor('cropperCanvas', dataUrl);

    const btnApply = document.getElementById('btnCropperApply');
    const btnSkip = document.getElementById('btnCropperSkip');
    const btnReset = document.getElementById('btnCropperReset');

    if (btnApply) {
        btnApply.onclick = () => {
            console.log('[Cropper] Applying 4-point perspective warp...');
            const cropped = PerspectiveCropper.cropAndWarp() || dataUrl;
            modal.style.display = 'none';
            callback(cropped);
        };
    }

    if (btnSkip) {
        btnSkip.onclick = () => {
            console.log('[Cropper] Skipping perspective cropping...');
            modal.style.display = 'none';
            callback(dataUrl);
        };
    }

    if (btnReset) {
        btnReset.onclick = () => {
            console.log('[Cropper] Resetting corner handles...');
            PerspectiveCropper.resetDefaultPoints();
            PerspectiveCropper.renderEditor();
        };
    }
}

function addLabelImage(dataUrl) {
    if (scanState.labelImages.length >= 4) return;
    openPerspectiveCropper(dataUrl, (finalDataUrl) => {
        commitLabelImage(finalDataUrl);
    });
}

function commitLabelImage(dataUrl) {
    console.log('[Label] commitLabelImage called. Data length:', Math.round(dataUrl.length / 1024), 'KB');
    if (scanState.labelImages.length >= 4) return;
    scanState.labelImages.push(dataUrl);
    scanState.labelImage = scanState.labelImages[0];

    const preview = document.getElementById('capturedLabelPreview');
    const feedContainer = document.getElementById('cameraFeedContainer3') || document.getElementById('cameraFeedContainer');
    const btnCapture = document.getElementById('btnCaptureLabel');
    const btnRetake = document.getElementById('btnRetakeLabel');
    const btnRunAi = document.getElementById('btnRunAiCheck');

    if (preview) { preview.src = dataUrl; preview.style.display = 'none'; }
    if (feedContainer) feedContainer.style.display = 'block';
    if (btnCapture) {
        btnCapture.style.display = scanState.labelImages.length < 4 ? 'inline-flex' : 'none';
        btnCapture.textContent = scanState.labelImages.length < 4 ? '📸 Add Label Photo' : '📸 Photo Limit Reached';
    }
    if (btnRetake) {
        btnRetake.style.display = 'inline-flex';
        btnRetake.onclick = () => {
            scanState.labelImage = null;
            scanState.labelImages = [];
            if (preview) preview.style.display = 'none';
            if (feedContainer) feedContainer.style.display = 'block';
            if (btnCapture) {
                btnCapture.style.display = 'inline-flex';
                btnCapture.textContent = '📸 Take Label Snapshot';
            }
            if (btnRetake) btnRetake.style.display = 'none';
            if (btnRunAi) btnRunAi.disabled = true;
            renderLabelPhotoCollection();
        };
    }
    const labelVideo = document.getElementById('labelCameraFeed');
    if (labelVideo && cameraStream) {
        labelVideo.srcObject = cameraStream;
        labelVideo.play().catch(() => {});
    }
    if (btnRunAi) { btnRunAi.disabled = false; btnRunAi.style.opacity = '1'; }
    renderLabelPhotoCollection();
    console.log('[Label] Label photo committed after perspective check.');
}

function renderLabelPhotoCollection() {
    const collection = document.getElementById('labelPhotoCollection');
    const thumbnails = document.getElementById('labelPhotoThumbnails');
    const count = document.getElementById('labelPhotoCount');
    if (!collection || !thumbnails || !count) return;
    count.textContent = `${scanState.labelImages.length} / 4`;
    collection.style.display = scanState.labelImages.length ? 'block' : 'none';
    thumbnails.innerHTML = '';
    scanState.labelImages.forEach((image, index) => {
        const thumbnail = document.createElement('img');
        thumbnail.src = image;
        thumbnail.alt = `Inspection photo ${index + 1}`;
        thumbnail.style.cssText = 'width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; border: 1px solid #CBD5E1;';
        thumbnails.appendChild(thumbnail);
    });
}

function updateCalibrationRatio() {
    const slider = document.getElementById('calibrationSlider');
    if (!slider) return;
    const cardPx = parseInt(slider.value, 10);
    const px = document.getElementById('calibPxDisplay');
    const dpiEl = document.getElementById('computedDpiDisplay');
    if (px) px.textContent = `${cardPx} px`;
    scanState.calibration.cardPixelWidth = cardPx;
    scanState.calibration.pxPerMm = cardPx / scanState.calibration.cardWidthMm;
    const dpi = Math.round(scanState.calibration.pxPerMm * 25.4);
    if (dpiEl) dpiEl.textContent = `${dpi} DPI (${scanState.calibration.pxPerMm.toFixed(2)} px/mm)`;
}

function initStepHandlers() {
    console.log('[Scanner] Initializing all step handlers...');

    // Step 1: Manual Barcode / Skip
    const btnManual = document.getElementById('btnManualBarcode');
    if (btnManual) {
        btnManual.onclick = () => {
            const input = prompt('Enter 8, 12, 13 or 14-digit GTIN / EAN barcode:');
            if (input && input.trim().length >= 8) processBarcode(input.trim());
        };
    }

    const btnSkip = document.getElementById('btnSkipBarcode');
    if (btnSkip) {
        btnSkip.onclick = () => {
            console.log('[Scanner] Skip barcode — going to label OCR mode');
            isDetectingBarcode = false;
            scanState.barcodeData = { barcode: null, isRegistered: false, verificationStatus: 'label_lookup_mode' };
            goToStep(3);
        };
    }

    // Step 2 → 3
    const btnProceedLabel = document.getElementById('btnProceedToLabel');
    if (btnProceedLabel) btnProceedLabel.onclick = () => goToStep(3);

    // Step 3: Capture
    const btnCap = document.getElementById('btnCaptureLabel');
    if (btnCap) btnCap.onclick = captureLabelPhoto;
    else console.warn('[Scanner] #btnCaptureLabel NOT FOUND in DOM');

    // File upload — HTML uses id="fileUploadLabel"
    const fileInput = document.getElementById('fileUploadLabel') || document.getElementById('labelFileInput');
    if (fileInput) { fileInput.onchange = handleFileUpload; console.log('[Scanner] File input bound:', fileInput.id); }
    else console.warn('[Scanner] File upload input NOT FOUND — check HTML for id="fileUploadLabel"');

    const slider = document.getElementById('calibrationSlider');
    if (slider) slider.oninput = updateCalibrationRatio;

    // Step 3: Run AI
    const btnRun = document.getElementById('btnRunAiCheck');
    if (btnRun) {
        btnRun.onclick = async () => {
            if (!scanState.labelImage) { alert('Please capture or upload a label photo first.'); return; }
            await runMultimodalAnalysis();
        };
    } else console.warn('[Scanner] #btnRunAiCheck NOT FOUND in DOM');

    // Step 4 → 5
    const btnProceedReport = document.getElementById('btnProceedToReport');
    if (btnProceedReport) btnProceedReport.onclick = () => goToStep(5);

    // Step 5: Save
    const btnSave = document.getElementById('btnSaveAndGenerateDossier') || document.getElementById('btnSaveAndReport');
    if (btnSave) {
        btnSave.onclick = async () => {
            showLoading('Saving inspection record...');
            const record = {
                product_name: scanState.visionData?.product_name?.value || scanState.barcodeData?.productName || 'Inspected Commodity',
                brand: scanState.visionData?.manufacturer_name?.value || scanState.barcodeData?.brand || 'Unknown',
                barcode: scanState.barcodeData?.barcode || null,
                overall_score: scanState.complianceReport?.overall_score || 0,
                compliance_status: scanState.complianceReport?.compliance_status || 'NON_COMPLIANT',
                authenticity_status: scanState.complianceReport?.authenticity_status || 'AUTHENTIC',
                declarations: scanState.complianceReport?.declarations || [],
                violations: scanState.complianceReport?.violations || [],
                vision_raw: scanState.visionData || {},
                barcode_data: scanState.barcodeData || {},
                image_url: scanState.labelImage
            };
            console.log('[Save] Saving scan record:', record);
            try {
                const saved = await SupabaseService.saveScan(record);
                hideLoading();
                window.location.href = saved?.id ? `report.html?id=${saved.id}` : 'report.html';
            } catch(e) {
                hideLoading();
                alert('Save error: ' + e.message);
            }
        };
    } else console.warn('[Scanner] Save button NOT FOUND — check id="btnSaveAndGenerateDossier" or "btnSaveAndReport"');

    const btnNewScan = document.getElementById('btnNewScan');
    if (btnNewScan) {
        btnNewScan.onclick = () => window.location.reload();
    }

    console.log('[Scanner] ✅ All step handlers initialized.');
}

async function runMultimodalAnalysis() {
    console.group('[Vision] === Multimodal Analysis Start ===');
    const labelImages = scanState.labelImages.length ? scanState.labelImages : [scanState.labelImage];
    console.log('[Vision] PDP images:', labelImages.map((image, index) => ({
        index: index + 1,
        size: image ? Math.round(image.length / 1024) + 'KB' : 'MISSING'
    })));
    console.log('[Vision] Barcode data:', JSON.stringify(scanState.barcodeData));
    console.log('[Vision] BACKEND_URL:', CONFIG.BACKEND_URL);
    console.log('[Vision] VISION_PROXY_URL:', CONFIG.VISION_PROXY_URL);

    showLoading('Gemini Vision AI analyzing mandatory declarations & label authenticity...');
    goToStep(4);

    try {
        console.log('[Vision] → Calling VisionEngine.analyzeLabel()...');
        const response = await VisionEngine.analyzeLabel(labelImages, scanState.barcodeData);

        console.log('[Vision] ← Raw API response:', JSON.stringify(response, null, 2));
        console.log('[Vision] response.success:', response?.success);
        console.log('[Vision] response.simulated:', response?.simulated);
        console.log('[Vision] response.error:', response?.error);
        console.log('[Vision] response.data keys:', response?.data ? Object.keys(response.data) : 'NO DATA');

        if (response && response.data) {
            scanState.visionData = response.data;
            console.log('[Compliance] Running ComplianceEngine.evaluateCompliance()...');
            const evalResult = ComplianceEngine.evaluateCompliance(response.data, scanState.barcodeData, scanState.calibration);
            console.log('[Compliance] Result:', JSON.stringify(evalResult, null, 2));
            scanState.complianceReport = evalResult;

            renderAiExtractionCards(response.data);
            renderComplianceSummary(evalResult);
            goToStep(5);
            console.log('[Vision] ✅ Render complete. Step 4 populated.');
        } else {
            const errMsg = response?.error || 'No data returned from Vision API';
            console.error('[Vision] ❌ Empty/invalid response:', response);
            throw new Error(errMsg);
        }
    } catch (err) {
        console.error('[Vision] ❌ Exception during analysis:', err.message, err.stack);
        alert('Vision analysis error: ' + err.message);
    } finally {
        console.log('[Vision] Hiding loading overlay...');
        hideLoading();
        console.groupEnd();
    }
}

function renderAiExtractionCards(data) {
    const grid = document.getElementById('aiExtractionGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const items = [
        { label: 'Commodity Name (Rule 6c)', key: 'product_name', icon: '📦' },
        { label: 'Manufacturer / Packer (Rule 6a)', key: 'manufacturer_name', icon: '🏭' },
        { label: 'Postal Address & PIN', key: 'manufacturer_address', icon: '📍' },
        { label: 'FSSAI License / Food Safety', key: 'fssai_license', icon: '📜' },
        { label: 'Net Quantity (Rule 6d)', key: 'net_quantity', icon: '⚖️' },
        { label: 'Mfg / Packing Date (Rule 6e)', key: 'mfg_date', icon: '📅' },
        { label: 'Maximum Retail Price (Rule 6f)', key: 'mrp', icon: '💰' },
        { label: 'Consumer Care Cell (Rule 6g)', key: 'consumer_care', icon: '📞' }
    ];

    items.forEach(item => {
        const field = data[item.key];
        const val = field?.value || 'Not Detected';
        const isPresent = Boolean(field?.present && field?.value);
        const card = document.createElement('div');
        card.className = 'declaration-field-card';
        card.style.cssText = `background: #FFFFFF; border: 1px solid ${isPresent ? '#E2E8F0' : '#FECDD3'}; border-radius: 8px; padding: 14px;`;

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                <span style="font-weight: 600; font-size: 0.85rem; color: #475569;">${item.icon} ${item.label}</span>
                <span class="badge ${isPresent ? 'badge-success' : 'badge-danger'}" style="font-size: 0.72rem;">
                    ${isPresent ? '✓ Detected' : '✗ Missing'}
                </span>
            </div>
            <div style="font-weight: 700; font-size: 0.95rem; color: ${isPresent ? '#0F172A' : '#E11D48'}; margin-bottom: 4px;">
                ${val}
            </div>
            ${field?.confidence ? `<div style="font-size: 0.75rem; color: #64748B;">AI Confidence: ${(field.confidence * 100).toFixed(0)}%</div>` : ''}
        `;
        grid.appendChild(card);
    });
}

function renderComplianceSummary(evalResult) {
    const scoreVal = document.getElementById('summaryScoreVal') || document.getElementById('resComplianceScore');
    const scoreRing = document.getElementById('summaryScoreRing');
    const statusBadge = document.getElementById('summaryStatusBadge') || document.getElementById('resOverallStatus');
    const authBadge = document.getElementById('summaryAuthBadge') || document.getElementById('resAuthStatus');
    const violCount = document.getElementById('summaryViolationsCount');
    const violList = document.getElementById('summaryViolationsList') || document.getElementById('resViolationsList');
    const declarationsList = document.getElementById('resDeclarationsList');

    if (scoreVal) scoreVal.textContent = `${evalResult.overall_score}%`;
    if (scoreRing) {
        const color = evalResult.overall_score >= 85 ? '#059669' : (evalResult.overall_score >= 60 ? '#D97706' : '#DC2626');
        scoreRing.style.borderTopColor = color;
    }

    if (statusBadge) {
        statusBadge.textContent = evalResult.compliance_status.replace('_', ' ');
        statusBadge.className = `badge ${evalResult.compliance_status === 'COMPLIANT' ? 'badge-success' : (evalResult.compliance_status === 'PARTIAL_COMPLIANCE' ? 'badge-warning' : 'badge-danger')}`;
    }

    if (authBadge) {
        authBadge.textContent = evalResult.authenticity_status.replace('_', ' ');
        authBadge.className = `badge ${evalResult.authenticity_status === 'AUTHENTIC' ? 'badge-success' : 'badge-danger'}`;
    }

    if (violCount) violCount.textContent = evalResult.violations.length;

    if (violList) {
        violList.innerHTML = '';
        if (evalResult.violations.length === 0) {
            violList.innerHTML = '<div style="color: #059669; font-weight: 600; padding: 10px 0;">✓ Perfect Compliance: All Rule 6 mandatory declarations and font standards satisfied.</div>';
        } else {
            evalResult.violations.forEach(v => {
                const item = document.createElement('div');
                item.style.cssText = 'background: #FFF1F2; border-left: 4px solid #E11D48; padding: 10px 14px; margin-bottom: 8px; border-radius: 4px;';
                item.innerHTML = `
                    <div style="display: flex; justify-content: space-between; font-weight: 700; color: #9F1239; font-size: 0.88rem;">
                        <span>${v.rule_ref}: ${v.rule_name}</span>
                        <span class="badge badge-danger">${v.severity.toUpperCase()}</span>
                    </div>
                    <div style="font-size: 0.82rem; color: #881337; margin-top: 2px;">${v.description}</div>
                    <div style="font-size: 0.75rem; color: #4C0519; margin-top: 4px;">Penalty: ${v.penalty_provision}</div>
                `;
                violList.appendChild(item);
            });
        }
    }

    if (declarationsList) {
        declarationsList.innerHTML = '';
        evalResult.declarations.forEach(declaration => {
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid #E2E8F0;';
            item.innerHTML = `
                <div>
                    <strong>${declaration.name}</strong>
                    <div class="text-muted small">${declaration.rule_ref}</div>
                    <div class="text-secondary small">${declaration.value || 'Not detected'}</div>
                </div>
                <span class="badge ${declaration.status === 'compliant' ? 'badge-success' : (declaration.status === 'warning' ? 'badge-warning' : 'badge-danger')}">
                    ${declaration.status.toUpperCase()}
                </span>`;
            declarationsList.appendChild(item);
        });
    }
}

function showLoading(msg) {
    const el = document.getElementById('loadingOverlay') || document.getElementById('globalLoadingOverlay');
    if (el) {
        const text = document.getElementById('loadingText') || document.getElementById('loadingMessage') || el.querySelector('h3');
        if (text) text.textContent = msg;
        el.style.display = 'flex';
    }
}

function hideLoading() {
    const el1 = document.getElementById('loadingOverlay');
    if (el1) el1.style.display = 'none';
    const el2 = document.getElementById('globalLoadingOverlay');
    if (el2) el2.style.display = 'none';
}
