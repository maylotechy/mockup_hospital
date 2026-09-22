// Restricted proxy for sharing only facility-group-7-demo through ngrok.
// Laragon Apache handles concurrent PHP requests; this proxy prevents the
// tunnel from exposing any sibling projects on Apache port 80.
const http = require('http');

const LISTEN_HOST = '127.0.0.1';
const LISTEN_PORT = 8787;
const APACHE_HOST = '127.0.0.1';
const APACHE_PORT = 80;
const DEMO_PREFIX = '/mock_hospitals/facility-group-7-demo';

function isAllowedPath(pathname) {
    return pathname === '/' || pathname === '/frontend' || pathname.startsWith('/frontend/')
        || pathname === '/backend' || pathname.startsWith('/backend/');
}

const server = http.createServer((request, response) => {
    const parsed = new URL(request.url, 'http://localhost');
    if (!isAllowedPath(parsed.pathname)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
    }

    if (parsed.pathname === '/') {
        response.writeHead(302, { Location: '/frontend/' });
        response.end();
        return;
    }

    const headers = { ...request.headers, host: 'localhost' };
    delete headers['accept-encoding'];
    const upstream = http.request({
        hostname: APACHE_HOST,
        port: APACHE_PORT,
        method: request.method,
        path: DEMO_PREFIX + parsed.pathname + parsed.search,
        headers,
    }, upstreamResponse => {
        response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
    });

    upstream.on('error', error => {
        if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ success: false, message: 'Demo backend unavailable', error: error.message }));
    });
    request.pipe(upstream);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    console.log(`Facility Group 7 tunnel proxy listening on http://${LISTEN_HOST}:${LISTEN_PORT}`);
});
