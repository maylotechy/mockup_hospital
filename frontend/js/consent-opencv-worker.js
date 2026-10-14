'use strict';

const OPENCV_URL = 'https://docs.opencv.org/4.x/opencv.js';
let cvApi = null;

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

function distance(first, second) {
    return Math.hypot(second.x - first.x, second.y - first.y);
}

function matFromPixels(width, height, pixels) {
    const mat = new cvApi.Mat(height, width, cvApi.CV_8UC4);
    mat.data.set(new Uint8ClampedArray(pixels));
    return mat;
}

function detectDocument(src) {
    const scale = Math.min(1, 1200 / Math.max(src.cols, src.rows));
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
        resized.delete();
        gray.delete();
        blurred.delete();
        edges.delete();
        contours.delete();
        hierarchy.delete();
    }

    return bestPoints ? orderPoints(bestPoints).map(point => ({
        x: Math.max(0, Math.min(1, point.x / src.cols)),
        y: Math.max(0, Math.min(1, point.y / src.rows))
    })) : null;
}

function processImage(message) {
    const src = matFromPixels(message.width, message.height, message.pixels);
    let normalizedCorners = message.corners;
    let detected = false;
    if (message.autoDetect) {
        const detectedCorners = detectDocument(src);
        if (detectedCorners) {
            normalizedCorners = detectedCorners;
            detected = true;
        }
    }

    const points = orderPoints(normalizedCorners.map(point => ({ x: point.x * src.cols, y: point.y * src.rows })));
    const rawWidth = Math.max(1, Math.round(Math.max(distance(points[0], points[1]), distance(points[3], points[2]))));
    const rawHeight = Math.max(1, Math.round(Math.max(distance(points[0], points[3]), distance(points[1], points[2]))));
    const scale = Math.min(1, 1800 / Math.max(rawWidth, rawHeight));
    const width = Math.max(1, Math.round(rawWidth * scale));
    const height = Math.max(1, Math.round(rawHeight * scale));
    const warped = new cvApi.Mat();
    const output = new cvApi.Mat();
    const sourceCoordinates = cvApi.matFromArray(4, 1, cvApi.CV_32FC2, points.flatMap(point => [point.x, point.y]));
    const targetCoordinates = cvApi.matFromArray(4, 1, cvApi.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
    const transform = cvApi.getPerspectiveTransform(sourceCoordinates, targetCoordinates);

    try {
        cvApi.warpPerspective(src, warped, transform, new cvApi.Size(width, height), cvApi.INTER_LINEAR, cvApi.BORDER_CONSTANT, new cvApi.Scalar(255, 255, 255, 255));
        if (message.mode === 'color') {
            warped.copyTo(output);
        } else {
            cvApi.cvtColor(warped, output, cvApi.COLOR_RGBA2GRAY);
            if (message.mode === 'binary') {
                const thresholded = new cvApi.Mat();
                cvApi.adaptiveThreshold(output, thresholded, 255, cvApi.ADAPTIVE_THRESH_GAUSSIAN_C, cvApi.THRESH_BINARY, 31, 15);
                thresholded.copyTo(output);
                thresholded.delete();
            }
        }

        const rgba = new cvApi.Mat();
        if (output.channels() === 1) cvApi.cvtColor(output, rgba, cvApi.COLOR_GRAY2RGBA);
        else output.copyTo(rgba);
        const pixels = new Uint8ClampedArray(rgba.data);
        rgba.delete();
        self.postMessage({
            type: 'result',
            requestId: message.requestId,
            width,
            height,
            pixels: pixels.buffer,
            corners: normalizedCorners,
            detected,
            autoDetectRequested: message.autoDetect
        }, [pixels.buffer]);
    } finally {
        src.delete();
        warped.delete();
        output.delete();
        sourceCoordinates.delete();
        targetCoordinates.delete();
        transform.delete();
    }
}

self.onmessage = event => {
    if (event.data?.type !== 'process' || !cvApi) return;
    try {
        processImage(event.data);
    } catch (error) {
        self.postMessage({ type: 'error', message: error?.message || 'OpenCV processing failed.' });
    }
};

(async () => {
    try {
        self.importScripts(OPENCV_URL);
        let loaded = self.cv;
        if (loaded instanceof Promise) loaded = await loaded;
        const deadline = Date.now() + 15000;
        while (!loaded?.Mat && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 50));
            loaded = self.cv;
            if (loaded instanceof Promise) loaded = await loaded;
        }
        if (!loaded?.Mat) throw new Error('OpenCV did not initialize.');
        cvApi = loaded;
        self.postMessage({ type: 'ready' });
    } catch (error) {
        self.postMessage({ type: 'error', message: error?.message || 'OpenCV could not load.' });
    }
})();
