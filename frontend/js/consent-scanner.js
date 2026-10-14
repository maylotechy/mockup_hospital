(function () {
    'use strict';

    const MAX_FILE_BYTES = 5 * 1024 * 1024;
    const DEFAULT_CORNERS = [
        { x: 0.03, y: 0.03 },
        { x: 0.97, y: 0.03 },
        { x: 0.97, y: 0.97 },
        { x: 0.03, y: 0.97 }
    ];

    let cameraStream = null;
    let corners = DEFAULT_CORNERS.map(point => ({ ...point }));
    let scanMode = 'grayscale';
    let sourceKind = 'camera';
    let suppressFileChange = false;
    let processingTimer = null;
    let openCvWorker = null;
    let openCvWorkerReady = false;
    let openCvWorkerFailed = false;
    let pendingAutoDetect = false;
    let workerRequestId = 0;
    let latestWorkerRequestId = 0;

    const byId = id => document.getElementById(id);

    function show(element) {
        element?.classList.remove('hidden');
    }

    function hide(element) {
        element?.classList.add('hidden');
    }

    function setMessage(message, isError = false) {
        const element = byId('consentCameraMessage');
        if (!element) return;
        element.textContent = message;
        element.className = `mt-3 text-center text-sm ${isError ? 'text-red-600' : 'text-slate-500'}`;
    }

    function stopCamera() {
        cameraStream?.getTracks().forEach(track => track.stop());
        cameraStream = null;
        const video = byId('consentScannerVideo');
        if (video) video.srcObject = null;
    }

    function closeScanner() {
        stopCamera();
        window.clearTimeout(processingTimer);
        hide(byId('consentScannerModal'));
        document.body.classList.remove('overflow-hidden');
    }

    async function openCamera() {
        const modal = byId('consentScannerModal');
        show(modal);
        document.body.classList.add('overflow-hidden');
        show(byId('consentCameraStage'));
        hide(byId('consentEditorStage'));
        byId('btnCaptureConsent').disabled = true;
        setMessage('Requesting camera access…');

        if (!navigator.mediaDevices?.getUserMedia) {
            setMessage('Camera access requires HTTPS or localhost. You can still choose an image.', true);
            return;
        }

        try {
            stopCamera();
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            });
            const video = byId('consentScannerVideo');
            video.srcObject = cameraStream;
            await video.play();
            byId('btnCaptureConsent').disabled = false;
            setMessage('Keep the complete page inside the guide, then capture.');
        } catch (error) {
            const denied = error?.name === 'NotAllowedError';
            setMessage(denied ? 'Camera permission was denied. Allow camera access or choose an image.' : 'The camera could not be opened. Choose an image instead.', true);
        }
    }

    function drawVideoFrame() {
        const video = byId('consentScannerVideo');
        if (!video.videoWidth || !video.videoHeight) throw new Error('The camera is not ready.');
        const canvas = byId('consentSourceCanvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    function loadImageFile(file) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            const objectUrl = URL.createObjectURL(file);
            image.onload = () => {
                try {
                    const maxDimension = 2600;
                    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
                    const canvas = byId('consentSourceCanvas');
                    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                    canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
                    resolve();
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
            };
            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('The selected image could not be read.'));
            };
            image.src = objectUrl;
        });
    }

    function orderPoints(points) {
        const sum = point => point.x + point.y;
        const difference = point => point.x - point.y;
        return [
            points.reduce((best, point) => sum(point) < sum(best) ? point : best),
            points.reduce((best, point) => difference(point) > difference(best) ? point : best),
            points.reduce((best, point) => sum(point) > sum(best) ? point : best),
            points.reduce((best, point) => difference(point) < difference(best) ? point : best)
        ];
    }

    function detectDocument(cvApi) {
        const canvas = byId('consentSourceCanvas');
        const src = cvApi.imread(canvas);
        const scale = Math.min(1, 1400 / Math.max(src.cols, src.rows));
        const resized = new cvApi.Mat();
        const gray = new cvApi.Mat();
        const blurred = new cvApi.Mat();
        const edges = new cvApi.Mat();
        const contours = new cvApi.MatVector();
        const hierarchy = new cvApi.Mat();
        let bestPoints = null;
        let bestArea = 0;

        try {
            cvApi.resize(src, resized, new cvApi.Size(0, 0), scale, scale, cvApi.INTER_AREA);
            cvApi.cvtColor(resized, gray, cvApi.COLOR_RGBA2GRAY);
            cvApi.GaussianBlur(gray, blurred, new cvApi.Size(5, 5), 0, 0, cvApi.BORDER_DEFAULT);
            cvApi.Canny(blurred, edges, 50, 150);
            cvApi.findContours(edges, contours, hierarchy, cvApi.RETR_LIST, cvApi.CHAIN_APPROX_SIMPLE);

            for (let index = 0; index < contours.size(); index += 1) {
                const contour = contours.get(index);
                const approximation = new cvApi.Mat();
                try {
                    const perimeter = cvApi.arcLength(contour, true);
                    cvApi.approxPolyDP(contour, approximation, 0.02 * perimeter, true);
                    const area = Math.abs(cvApi.contourArea(approximation));
                    if (approximation.rows === 4 && area > bestArea && area > resized.cols * resized.rows * 0.12) {
                        const data = approximation.data32S;
                        bestPoints = Array.from({ length: 4 }, (_, pointIndex) => ({
                            x: data[pointIndex * 2] / scale,
                            y: data[pointIndex * 2 + 1] / scale
                        }));
                        bestArea = area;
                    }
                } finally {
                    approximation.delete();
                    contour.delete();
                }
            }
        } finally {
            src.delete();
            resized.delete();
            gray.delete();
            blurred.delete();
            edges.delete();
            contours.delete();
            hierarchy.delete();
        }

        if (!bestPoints) {
            corners = DEFAULT_CORNERS.map(point => ({ ...point }));
            return false;
        }

        corners = orderPoints(bestPoints).map(point => ({
            x: Math.max(0, Math.min(1, point.x / canvas.width)),
            y: Math.max(0, Math.min(1, point.y / canvas.height))
        }));
        return true;
    }

    function distance(first, second) {
        return Math.hypot(second.x - first.x, second.y - first.y);
    }

    function renderProcessedImage(cvApi) {
        const sourceCanvas = byId('consentSourceCanvas');
        const pixelPoints = corners.map(point => ({ x: point.x * sourceCanvas.width, y: point.y * sourceCanvas.height }));
        const ordered = orderPoints(pixelPoints);
        const width = Math.max(1, Math.round(Math.max(distance(ordered[0], ordered[1]), distance(ordered[3], ordered[2]))));
        const height = Math.max(1, Math.round(Math.max(distance(ordered[0], ordered[3]), distance(ordered[1], ordered[2]))));
        const outputScale = Math.min(1, 2200 / Math.max(width, height));
        const outputWidth = Math.max(1, Math.round(width * outputScale));
        const outputHeight = Math.max(1, Math.round(height * outputScale));

        const src = cvApi.imread(sourceCanvas);
        const warped = new cvApi.Mat();
        const destination = new cvApi.Mat();
        const sourceCoordinates = cvApi.matFromArray(4, 1, cvApi.CV_32FC2, ordered.flatMap(point => [point.x, point.y]));
        const targetCoordinates = cvApi.matFromArray(4, 1, cvApi.CV_32FC2, [
            0, 0,
            outputWidth - 1, 0,
            outputWidth - 1, outputHeight - 1,
            0, outputHeight - 1
        ]);
        const transform = cvApi.getPerspectiveTransform(sourceCoordinates, targetCoordinates);

        try {
            cvApi.warpPerspective(src, warped, transform, new cvApi.Size(outputWidth, outputHeight), cvApi.INTER_LINEAR, cvApi.BORDER_CONSTANT, new cvApi.Scalar(255, 255, 255, 255));
            if (scanMode === 'color') {
                warped.copyTo(destination);
            } else {
                cvApi.cvtColor(warped, destination, cvApi.COLOR_RGBA2GRAY);
                if (scanMode === 'binary') {
                    const thresholded = new cvApi.Mat();
                    cvApi.adaptiveThreshold(destination, thresholded, 255, cvApi.ADAPTIVE_THRESH_GAUSSIAN_C, cvApi.THRESH_BINARY, 31, 15);
                    thresholded.copyTo(destination);
                    thresholded.delete();
                } else {
                    cvApi.equalizeHist(destination, destination);
                }
            }
            cvApi.imshow(byId('consentOutputCanvas'), destination);
        } finally {
            src.delete();
            warped.delete();
            destination.delete();
            sourceCoordinates.delete();
            targetCoordinates.delete();
            transform.delete();
        }

        const warnings = [];
        if (outputWidth < 900 || outputHeight < 1200) warnings.push('The cropped document has a low resolution; text or signatures may be difficult to read.');
        const warning = byId('consentScanWarning');
        warning.textContent = warnings.length ? warnings.join(' ') : 'Check that the complete page, consent text, names, and signatures are readable before using this copy.';
        warning.className = `mt-4 rounded-xl border px-4 py-3 text-xs ${warnings.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`;
    }

    function otsuThreshold(imageData) {
        const histogram = new Uint32Array(256);
        const pixels = imageData.data;
        for (let index = 0; index < pixels.length; index += 4) histogram[pixels[index]] += 1;

        const total = imageData.width * imageData.height;
        let weightedTotal = 0;
        for (let value = 0; value < 256; value += 1) weightedTotal += value * histogram[value];

        let backgroundWeight = 0;
        let backgroundSum = 0;
        let bestVariance = -1;
        let threshold = 160;
        for (let value = 0; value < 256; value += 1) {
            backgroundWeight += histogram[value];
            if (!backgroundWeight) continue;
            const foregroundWeight = total - backgroundWeight;
            if (!foregroundWeight) break;
            backgroundSum += value * histogram[value];
            const backgroundMean = backgroundSum / backgroundWeight;
            const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
            const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
            if (variance > bestVariance) {
                bestVariance = variance;
                threshold = value;
            }
        }
        return threshold;
    }

    function renderCanvasFallback() {
        const source = byId('consentSourceCanvas');
        const output = byId('consentOutputCanvas');
        const minimumX = Math.max(0, Math.min(...corners.map(point => point.x)));
        const maximumX = Math.min(1, Math.max(...corners.map(point => point.x)));
        const minimumY = Math.max(0, Math.min(...corners.map(point => point.y)));
        const maximumY = Math.min(1, Math.max(...corners.map(point => point.y)));
        const sourceX = Math.round(minimumX * source.width);
        const sourceY = Math.round(minimumY * source.height);
        const sourceWidth = Math.max(1, Math.round((maximumX - minimumX) * source.width));
        const sourceHeight = Math.max(1, Math.round((maximumY - minimumY) * source.height));
        const scale = Math.min(1, 2200 / Math.max(sourceWidth, sourceHeight));
        output.width = Math.max(1, Math.round(sourceWidth * scale));
        output.height = Math.max(1, Math.round(sourceHeight * scale));

        const context = output.getContext('2d', { alpha: false, willReadFrequently: scanMode === 'binary' });
        context.save();
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, output.width, output.height);
        context.filter = scanMode === 'color' ? 'none' : 'grayscale(1) contrast(1.04) brightness(1.02)';
        context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, output.width, output.height);
        context.restore();

        if (scanMode === 'binary') {
            const imageData = context.getImageData(0, 0, output.width, output.height);
            const threshold = otsuThreshold(imageData);
            for (let index = 0; index < imageData.data.length; index += 4) {
                const value = imageData.data[index] >= threshold ? 255 : 0;
                imageData.data[index] = value;
                imageData.data[index + 1] = value;
                imageData.data[index + 2] = value;
            }
            context.putImageData(imageData, 0, 0);
        }

        const warning = byId('consentScanWarning');
        warning.textContent = 'Basic scanner mode is active because OpenCV could not load. Cropping, rotation, grayscale, and black-and-white enhancement work, but automatic page detection and perspective correction are unavailable.';
        warning.className = 'mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800';
    }

    function applyWorkerResult(message) {
        if (message.requestId !== latestWorkerRequestId) return;
        if (message.corners?.length === 4) {
            corners = message.corners;
            updateCropOverlay();
        }
        const output = byId('consentOutputCanvas');
        output.width = message.width;
        output.height = message.height;
        const pixels = new Uint8ClampedArray(message.pixels);
        output.getContext('2d', { alpha: false }).putImageData(new ImageData(pixels, message.width, message.height), 0, 0);

        const warning = byId('consentScanWarning');
        const messages = [];
        if (message.autoDetectRequested && !message.detected) messages.push('Page edges were not detected confidently; adjust the blue handles.');
        if (message.width < 900 || message.height < 1200) messages.push('The cropped document has a low resolution.');
        warning.textContent = messages.length
            ? messages.join(' ')
            : 'Automatic page correction is ready. Check that the complete page, consent text, names, and signatures are readable.';
        warning.className = `mt-4 rounded-xl border px-4 py-3 text-xs ${messages.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`;
    }

    function ensureOpenCvWorker() {
        if (openCvWorker || openCvWorkerFailed) return;
        try {
            openCvWorker = new Worker('js/consent-opencv-worker.js?v=20260909b');
            const loadingTimeout = window.setTimeout(() => {
                if (openCvWorkerReady) return;
                openCvWorker?.terminate();
                openCvWorker = null;
                openCvWorkerFailed = true;
                renderCanvasFallback();
            }, 20000);

            openCvWorker.addEventListener('message', event => {
                const message = event.data || {};
                if (message.type === 'ready') {
                    window.clearTimeout(loadingTimeout);
                    openCvWorkerReady = true;
                    requestWorkerProcessing(pendingAutoDetect);
                } else if (message.type === 'result') {
                    applyWorkerResult(message);
                } else if (message.type === 'error') {
                    openCvWorkerFailed = true;
                    renderCanvasFallback();
                }
            });
            openCvWorker.addEventListener('error', () => {
                window.clearTimeout(loadingTimeout);
                openCvWorkerFailed = true;
                openCvWorker?.terminate();
                openCvWorker = null;
                renderCanvasFallback();
            });
        } catch (error) {
            openCvWorkerFailed = true;
        }
    }

    function requestWorkerProcessing(autoDetect = false) {
        pendingAutoDetect = autoDetect;
        ensureOpenCvWorker();
        if (!openCvWorkerReady || !openCvWorker) return;

        const source = byId('consentSourceCanvas');
        const imageData = source.getContext('2d', { alpha: false, willReadFrequently: true }).getImageData(0, 0, source.width, source.height);
        const requestId = ++workerRequestId;
        latestWorkerRequestId = requestId;
        openCvWorker.postMessage({
            type: 'process',
            requestId,
            width: imageData.width,
            height: imageData.height,
            pixels: imageData.data.buffer,
            corners,
            mode: scanMode,
            autoDetect
        }, [imageData.data.buffer]);
        pendingAutoDetect = false;
    }

    function updateCropOverlay() {
        const polygon = byId('consentCropPolygon');
        polygon.setAttribute('points', corners.map(point => `${point.x * 100},${point.y * 100}`).join(' '));
        document.querySelectorAll('.consent-crop-handle').forEach(handle => {
            const point = corners[Number(handle.dataset.corner)];
            handle.style.left = `${point.x * 100}%`;
            handle.style.top = `${point.y * 100}%`;
        });
    }

    function schedulePreview() {
        window.clearTimeout(processingTimer);
        processingTimer = window.setTimeout(() => {
            renderCanvasFallback();
            requestWorkerProcessing(false);
        }, 60);
    }

    function beginEditing(autoDetect = true) {
        stopCamera();
        hide(byId('consentCameraStage'));
        show(byId('consentEditorStage'));
        byId('btnUseConsentScan').disabled = false;
        corners = DEFAULT_CORNERS.map(point => ({ ...point }));
        updateCropOverlay();
        renderCanvasFallback();
        requestWorkerProcessing(autoDetect);
    }

    function rotateSourceClockwise() {
        const source = byId('consentSourceCanvas');
        const copy = document.createElement('canvas');
        copy.width = source.height;
        copy.height = source.width;
        const context = copy.getContext('2d', { alpha: false });
        context.translate(copy.width, 0);
        context.rotate(Math.PI / 2);
        context.drawImage(source, 0, 0);
        source.width = copy.width;
        source.height = copy.height;
        source.getContext('2d', { alpha: false }).drawImage(copy, 0, 0);
        beginEditing(true);
    }

    function canvasToBlob(canvas, type, quality) {
        return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create the scanned image.')), type, quality));
    }

    function safePatientName() {
        return String(byId('modalPatientName')?.textContent || 'Patient')
            .trim()
            .replace(/[^\p{L}\p{N}]+/gu, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 150) || 'Patient';
    }

    async function useProcessedCopy() {
        const button = byId('btnUseConsentScan');
        button.disabled = true;
        const originalText = button.innerHTML;
        button.innerHTML = '<span class="inline-block animate-spin me-2">◌</span>Preparing…';

        try {
            const canvas = byId('consentOutputCanvas');
            let blob = null;
            for (const quality of [0.92, 0.84, 0.74, 0.64]) {
                blob = await canvasToBlob(canvas, 'image/jpeg', quality);
                if (blob.size <= MAX_FILE_BYTES) break;
            }
            if (!blob || blob.size > MAX_FILE_BYTES) throw new Error('The processed image is larger than 5 MB. Crop it more tightly and try again.');

            const fileName = `consent_${safePatientName()}.jpg`;
            const file = new File([blob], fileName, { type: 'image/jpeg', lastModified: Date.now() });
            const transfer = new DataTransfer();
            transfer.items.add(file);
            suppressFileChange = true;
            byId('signedConsentForm').files = transfer.files;
            byId('signedConsentForm').dispatchEvent(new Event('change', { bubbles: true }));
            suppressFileChange = false;

            const status = byId('signedConsentScanStatus');
            status.innerHTML = `<i class="bi bi-check-circle-fill me-1"></i><strong>${fileName}</strong> is ready (${(file.size / 1024 / 1024).toFixed(2)} MB, ${scanMode === 'binary' ? 'black and white' : scanMode}).`;
            show(status);
            closeScanner();
        } catch (error) {
            window.Swal?.fire({ icon: 'error', title: 'Could not use scan', text: error.message });
        } finally {
            button.disabled = false;
            button.innerHTML = originalText;
        }
    }

    function chooseConsentImage() {
        closeScanner();
        const input = byId('signedConsentForm');
        if (!input) return;
        input.value = '';
        input.click();
    }

    function bindCropHandles() {
        document.querySelectorAll('.consent-crop-handle').forEach(handle => {
            handle.addEventListener('pointerdown', event => {
                event.preventDefault();
                const cornerIndex = Number(handle.dataset.corner);
                handle.setPointerCapture(event.pointerId);

                const move = moveEvent => {
                    const bounds = byId('consentCropSurface').getBoundingClientRect();
                    corners[cornerIndex] = {
                        x: Math.max(0, Math.min(1, (moveEvent.clientX - bounds.left) / bounds.width)),
                        y: Math.max(0, Math.min(1, (moveEvent.clientY - bounds.top) / bounds.height))
                    };
                    updateCropOverlay();
                    schedulePreview();
                };

                const finish = () => {
                    handle.removeEventListener('pointermove', move);
                    handle.removeEventListener('pointerup', finish);
                    handle.removeEventListener('pointercancel', finish);
                };

                handle.addEventListener('pointermove', move);
                handle.addEventListener('pointerup', finish);
                handle.addEventListener('pointercancel', finish);
            });
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        const modal = byId('consentScannerModal');
        const fileInput = byId('signedConsentForm');
        if (!modal || !fileInput) return;

        byId('btnScanSignedConsent').addEventListener('click', () => {
            sourceKind = 'camera';
            openCamera();
        });
        byId('btnCloseConsentScanner').addEventListener('click', closeScanner);
        byId('btnCaptureConsent').addEventListener('click', async () => {
            try {
                drawVideoFrame();
                sourceKind = 'camera';
                await beginEditing(true);
            } catch (error) {
                setMessage(error.message, true);
            }
        });
        byId('btnChooseConsentInstead').addEventListener('click', chooseConsentImage);
        byId('btnRetakeConsentScan').addEventListener('click', () => sourceKind === 'camera' ? openCamera() : chooseConsentImage());
        byId('btnRotateConsentScan').addEventListener('click', rotateSourceClockwise);
        byId('btnUseConsentScan').addEventListener('click', useProcessedCopy);

        document.querySelectorAll('.consent-scan-mode').forEach(button => {
            button.addEventListener('click', () => {
                scanMode = button.dataset.mode;
                document.querySelectorAll('.consent-scan-mode').forEach(candidate => {
                    const active = candidate === button;
                    candidate.classList.toggle('border-blue-600', active);
                    candidate.classList.toggle('bg-blue-50', active);
                    candidate.classList.toggle('text-blue-700', active);
                    candidate.classList.toggle('border-slate-300', !active);
                });
                schedulePreview();
            });
        });

        fileInput.addEventListener('change', async () => {
            if (suppressFileChange) return;
            if (fileInput.dataset.skipScannerOnce === 'true') {
                delete fileInput.dataset.skipScannerOnce;
                return;
            }
            const file = fileInput.files?.[0];
            const status = byId('signedConsentScanStatus');
            if (!file) {
                hide(status);
                return;
            }
            if (file.type === 'application/pdf') {
                const tooLarge = file.size > MAX_FILE_BYTES;
                status.className = `mt-3 rounded-xl border px-3 py-2 text-xs ${tooLarge ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`;
                status.innerHTML = `<i class="bi bi-file-earmark-pdf me-1"></i><strong>${file.name}</strong> ${tooLarge ? 'is larger than the 5 MB limit.' : 'will be uploaded unchanged.'}`;
                show(status);
                return;
            }
            if (!['image/jpeg', 'image/png'].includes(file.type)) return;

            show(modal);
            document.body.classList.add('overflow-hidden');
            sourceKind = 'upload';
            status.className = 'mt-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800';
            status.innerHTML = `<i class="bi bi-image me-1"></i><strong>${file.name}</strong> is selected. Approve the enhanced preview to replace it, or close the scanner to keep the original.`;
            show(status);
            try {
                await loadImageFile(file);
                await beginEditing(true);
            } catch (error) {
                window.Swal?.fire({ icon: 'error', title: 'Could not open image', text: error.message });
                closeScanner();
            }
        });

        modal.addEventListener('click', event => {
            if (event.target === modal) closeScanner();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeScanner();
        });
        byId('referralForm')?.addEventListener('reset', () => {
            window.setTimeout(() => hide(byId('signedConsentScanStatus')), 0);
        });

        bindCropHandles();
        updateCropOverlay();
    });
})();
