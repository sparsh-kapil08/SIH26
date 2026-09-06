// ============================================================
// DOCUMENT PERSPECTIVE CROPPER ENGINE
// 4-Point Homography Perspective Transformation for Package Labels
// Converts tilted/skewed PDP photos into flat, upright images
// ============================================================

const PerspectiveCropper = {
    canvas: null,
    ctx: null,
    image: null,
    points: [], // Array of {x, y} relative to canvas
    activePointIndex: -1,
    handleRadius: 14,
    isDragging: false,
    onCroppedCallback: null,

    // Initialize interactive editor on a target canvas element
    initEditor(canvasId, imageSrc, onCropped = null) {
        this.canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.onCroppedCallback = onCropped;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            this.image = img;
            this.resizeCanvasToContainer();
            this.resetDefaultPoints();
            this.renderEditor();
            this.attachEventListeners();
        };
        img.src = imageSrc;
    },

    resizeCanvasToContainer() {
        if (!this.canvas || !this.image) return;
        const container = this.canvas.parentElement;
        const containerWidth = container ? container.clientWidth : 640;
        const scale = Math.min(1, containerWidth / this.image.width);
        this.canvas.width = Math.round(this.image.width * scale);
        this.canvas.height = Math.round(this.image.height * scale);
    },

    resetDefaultPoints() {
        if (!this.canvas) return;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const marginX = w * 0.08;
        const marginY = h * 0.08;

        // TL, TR, BR, BL
        this.points = [
            { x: marginX, y: marginY },
            { x: w - marginX, y: marginY },
            { x: w - marginX, y: h - marginY },
            { x: marginX, y: h - marginY }
        ];
    },

    renderEditor() {
        if (!this.ctx || !this.image) return;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Clear canvas
        this.ctx.clearRect(0, 0, w, h);

        // Draw background image
        this.ctx.drawImage(this.image, 0, 0, w, h);

        // Draw semi-transparent dark mask over unselected region
        this.ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        this.ctx.fillRect(0, 0, w, h);

        // Clip selected quadrilateral region
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(this.points[0].x, this.points[0].y);
        for (let i = 1; i < 4; i++) {
            this.ctx.lineTo(this.points[i].x, this.points[i].y);
        }
        this.ctx.closePath();
        this.ctx.clip();

        // Redraw image inside clip region
        this.ctx.drawImage(this.image, 0, 0, w, h);

        // Light highlight fill for selection
        this.ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
        this.ctx.fill();
        this.ctx.restore();

        // Draw quadrilateral boundary lines
        this.ctx.strokeStyle = '#10B981';
        this.ctx.lineWidth = 2.5;
        this.ctx.beginPath();
        this.ctx.moveTo(this.points[0].x, this.points[0].y);
        for (let i = 1; i < 4; i++) {
            this.ctx.lineTo(this.points[i].x, this.points[i].y);
        }
        this.ctx.closePath();
        this.ctx.stroke();

        // Draw corner handles
        const labels = ['TL', 'TR', 'BR', 'BL'];
        this.points.forEach((pt, i) => {
            // Outer glow ring
            this.ctx.beginPath();
            this.ctx.arc(pt.x, pt.y, this.handleRadius + 3, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
            this.ctx.fill();

            // Inner circle
            this.ctx.beginPath();
            this.ctx.arc(pt.x, pt.y, this.handleRadius, 0, Math.PI * 2);
            this.ctx.fillStyle = this.activePointIndex === i ? '#FF9933' : '#10B981';
            this.ctx.fill();
            this.ctx.strokeStyle = '#FFFFFF';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            // Corner label text
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.font = 'bold 10px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(labels[i], pt.x, pt.y);
        });
    },

    attachEventListeners() {
        if (!this.canvas) return;

        const getPos = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: clientX - rect.left,
                y: clientY - rect.top
            };
        };

        const onStart = (e) => {
            const pos = getPos(e);
            let foundIdx = -1;
            for (let i = 0; i < 4; i++) {
                const dx = pos.x - this.points[i].x;
                const dy = pos.y - this.points[i].y;
                if (Math.sqrt(dx * dx + dy * dy) <= this.handleRadius + 10) {
                    foundIdx = i;
                    break;
                }
            }
            if (foundIdx !== -1) {
                this.isDragging = true;
                this.activePointIndex = foundIdx;
                this.renderEditor();
                e.preventDefault();
            }
        };

        const onMove = (e) => {
            if (!this.isDragging || this.activePointIndex === -1) return;
            const pos = getPos(e);
            // Constrain within canvas bounds
            const x = Math.max(0, Math.min(this.canvas.width, pos.x));
            const y = Math.max(0, Math.min(this.canvas.height, pos.y));

            this.points[this.activePointIndex] = { x, y };
            this.renderEditor();
            e.preventDefault();
        };

        const onEnd = () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.activePointIndex = -1;
                this.renderEditor();
            }
        };

        this.canvas.onmousedown = onStart;
        this.canvas.onmousemove = onMove;
        window.onmouseup = onEnd;

        this.canvas.ontouchstart = onStart;
        this.canvas.ontouchmove = onMove;
        window.ontouchend = onEnd;
    },

    // Perform 4-point perspective warp transformation on original high-res image
    cropAndWarp() {
        if (!this.image || !this.points || this.points.length !== 4) return null;

        // Map canvas points to original image resolution coordinates
        const scaleX = this.image.width / this.canvas.width;
        const scaleY = this.image.height / this.canvas.height;

        const srcPts = this.points.map(pt => ({
            x: pt.x * scaleX,
            y: pt.y * scaleY
        }));

        // Compute width & height of target flattened bounding box
        const topW = Math.hypot(srcPts[1].x - srcPts[0].x, srcPts[1].y - srcPts[0].y);
        const botW = Math.hypot(srcPts[2].x - srcPts[3].x, srcPts[2].y - srcPts[3].y);
        const outW = Math.max(100, Math.round(Math.max(topW, botW)));

        const leftH = Math.hypot(srcPts[3].x - srcPts[0].x, srcPts[3].y - srcPts[0].y);
        const rightH = Math.hypot(srcPts[2].x - srcPts[1].x, srcPts[2].y - srcPts[1].y);
        const outH = Math.max(100, Math.round(Math.max(leftH, rightH)));

        // Create target warped canvas
        const warpCanvas = document.createElement('canvas');
        warpCanvas.width = outW;
        warpCanvas.height = outH;
        const warpCtx = warpCanvas.getContext('2d');

        // Mesh grid interpolation (16x16 grid for smooth perspective transformation)
        const gridX = 16;
        const gridY = 16;

        // Bilinear interpolation function for quadrilateral coordinates
        const getQuadPt = (u, v) => {
            const x = (1 - u) * (1 - v) * srcPts[0].x +
                      u * (1 - v) * srcPts[1].x +
                      u * v * srcPts[2].x +
                      (1 - u) * v * srcPts[3].x;
            const y = (1 - u) * (1 - v) * srcPts[0].y +
                      u * (1 - v) * srcPts[1].y +
                      u * v * srcPts[2].y +
                      (1 - u) * v * srcPts[3].y;
            return { x, y };
        };

        for (let gx = 0; gx < gridX; gx++) {
            for (let gy = 0; gy < gridY; gy++) {
                const u0 = gx / gridX;
                const v0 = gy / gridY;
                const u1 = (gx + 1) / gridX;
                const v1 = (gy + 1) / gridY;

                const p00 = getQuadPt(u0, v0);
                const p10 = getQuadPt(u1, v0);
                const p11 = getQuadPt(u1, v1);
                const p01 = getQuadPt(u0, v1);

                const dx0 = u0 * outW;
                const dy0 = v0 * outH;
                const dw = (u1 - u0) * outW;
                const dh = (v1 - v0) * outH;

                // Triangle 1: p00, p10, p01
                this.drawWarpTriangle(warpCtx, this.image, p00, p10, p01, dx0, dy0, dx0 + dw, dy0, dx0, dy0 + dh);

                // Triangle 2: p10, p11, p01
                this.drawWarpTriangle(warpCtx, this.image, p10, p11, p01, dx0 + dw, dy0, dx0 + dw, dy0 + dh, dx0, dy0 + dh);
            }
        }

        const dataUrl = warpCanvas.toDataURL('image/jpeg', 0.92);
        if (this.onCroppedCallback) {
            this.onCroppedCallback(dataUrl);
        }
        return dataUrl;
    },

    // Affine transformation helper for triangle mesh texturing
    drawWarpTriangle(ctx, img, s0, s1, s2, d0x, d0y, d1x, d1y, d2x, d2y) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(d0x, d0y);
        ctx.lineTo(d1x, d1y);
        ctx.lineTo(d2x, d2y);
        ctx.closePath();
        ctx.clip();

        const denom = (s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y));
        if (Math.abs(denom) < 0.0001) {
            ctx.restore();
            return;
        }

        const a = (d0x * (s1.y - s2.y) + d1x * (s2.y - s0.y) + d2x * (s0.y - s1.y)) / denom;
        const b = (d0y * (s1.y - s2.y) + d1y * (s2.y - s0.y) + d2y * (s0.y - s1.y)) / denom;
        const c = (d0x * (s2.x - s1.x) + d1x * (s0.x - s2.x) + d2x * (s1.x - s0.x)) / denom;
        const d = (d0y * (s2.x - s1.x) + d1y * (s0.x - s2.x) + d2y * (s1.x - s0.x)) / denom;
        const e = (d0x * (s1.x * s2.y - s2.x * s1.y) + d1x * (s2.x * s0.y - s0.x * s2.y) + d2x * (s0.x * s1.y - s1.x * s0.y)) / denom;
        const f = (d0y * (s1.x * s2.y - s2.x * s1.y) + d1y * (s2.x * s0.y - s0.x * s2.y) + d2y * (s0.x * s1.y - s1.x * s0.y)) / denom;

        ctx.transform(a, b, c, d, e, f);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
    }
};

if (typeof window !== 'undefined') {
    window.PerspectiveCropper = PerspectiveCropper;
}
